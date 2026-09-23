import { randomUUID } from "node:crypto";
import { connect as netConnect } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

// A small Discord local-RPC client over Discord's IPC socket (a named pipe on
// Windows, a Unix socket elsewhere). It does just what nowplaying needs, which
// is set and clear the activity, so there is no third-party RPC dependency.
// Frames are: int32LE opcode, int32LE byte length, UTF-8 JSON.

export const OP = Object.freeze({ HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 });
const ACTIVITY_TYPES = Object.freeze({ playing: 0, listening: 2, watching: 3, competing: 5 });
const MAX_FRAME_BYTES = 64 * 1024;

export function discordIpcPaths({ platform = process.platform, env = process.env } = {}) {
  if (platform === "win32") return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const base = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || tmpdir();
  return Array.from({ length: 10 }, (_, i) => join(base, `discord-ipc-${i}`));
}

export function encodeFrame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  if (body.length > MAX_FRAME_BYTES) throw new RangeError("Discord IPC frame is too large");
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

// Splits a byte stream into frames. Returns the frames and the unused tail.
export function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 8) {
    const op = buffer.readInt32LE(offset);
    const length = buffer.readInt32LE(offset + 4);
    if (length < 0 || length > MAX_FRAME_BYTES) throw new RangeError("Discord IPC frame is invalid");
    if (buffer.length - offset - 8 < length) break;
    const body = buffer.subarray(offset + 8, offset + 8 + length).toString("utf8");
    let payload;
    try { payload = JSON.parse(body); } catch { throw new RangeError("Discord IPC frame is not JSON"); }
    frames.push({ op, payload });
    offset += 8 + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

// Maps the transport's activity (see toRpcActivity) onto Discord's wire shape.
export function toIpcActivity(activity) {
  const out = {};
  if (activity.type !== undefined) {
    if (!Object.hasOwn(ACTIVITY_TYPES, activity.type)) throw new TypeError("activity.type is not supported");
    out.type = ACTIVITY_TYPES[activity.type];
  }
  if (activity.details) out.details = activity.details;
  if (activity.state) out.state = activity.state;
  const timestamps = {};
  if (Number.isInteger(activity.startTimestamp)) timestamps.start = activity.startTimestamp * 1000;
  if (Number.isInteger(activity.endTimestamp)) timestamps.end = activity.endTimestamp * 1000;
  if (Object.keys(timestamps).length) out.timestamps = timestamps;
  const assets = {};
  if (activity.largeImageKey) assets.large_image = activity.largeImageKey;
  if (activity.largeImageText) assets.large_text = activity.largeImageText;
  if (activity.smallImageKey) assets.small_image = activity.smallImageKey;
  if (Object.keys(assets).length) out.assets = assets;
  return out;
}

async function openFirst(paths, connectImpl, timeoutMs) {
  for (const path of paths) {
    const socket = await new Promise((resolve) => {
      const candidate = connectImpl(path);
      const timer = setTimeout(() => { candidate.destroy(); resolve(null); }, timeoutMs);
      candidate.once("connect", () => { clearTimeout(timer); resolve(candidate); });
      candidate.once("error", () => { clearTimeout(timer); candidate.destroy(); resolve(null); });
    });
    if (socket) return socket;
  }
  throw new Error("Discord is not running");
}

export function createDiscordIpcClient({ paths = discordIpcPaths(), connectImpl = netConnect, pid = process.pid, timeoutMs = 5000, newNonce = randomUUID } = {}) {
  let socket;
  let buffer = Buffer.alloc(0);
  const pending = new Map();
  let ready;

  function fail(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    ready?.reject(error);
    ready = undefined;
    socket?.destroy();
    socket = undefined;
  }

  function onFrame({ op, payload }) {
    if (op === OP.PING) { socket?.write(encodeFrame(OP.PONG, payload)); return; }
    if (op === OP.CLOSE) { fail(new Error(`Discord closed the connection${payload?.message ? `: ${payload.message}` : ""}`)); return; }
    if (op !== OP.FRAME) return;
    if (payload?.cmd === "DISPATCH" && payload?.evt === "READY") { ready?.resolve(); ready = undefined; return; }
    const waiter = payload?.nonce && pending.get(payload.nonce);
    if (!waiter) return;
    pending.delete(payload.nonce);
    if (payload.evt === "ERROR") waiter.reject(new Error(`Discord rejected ${payload.cmd}: ${payload.data?.message ?? "error"}`));
    else waiter.resolve(payload.data);
  }

  function withTimeout(promise, label) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Discord ${label} timed out`)), timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
  }

  async function login({ clientId } = {}) {
    if (typeof clientId !== "string" || !/^\d{17,20}$/.test(clientId)) throw new TypeError("clientId: expected a Discord application ID");
    if (socket) return;
    const next = await openFirst(paths, connectImpl, timeoutMs);
    socket = next;
    buffer = Buffer.alloc(0);
    next.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let decoded;
      try { decoded = decodeFrames(buffer); } catch (error) { fail(error); return; }
      buffer = decoded.rest;
      for (const frame of decoded.frames) onFrame(frame);
    });
    next.on("error", () => fail(new Error("Discord connection closed")));
    next.on("close", () => { if (socket === next) fail(new Error("Discord connection closed")); });
    const handshake = new Promise((resolve, reject) => { ready = { resolve, reject }; });
    next.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: clientId }));
    try {
      await withTimeout(handshake, "handshake");
    } catch (error) {
      fail(error);
      throw error;
    }
  }

  function command(cmd, args) {
    if (!socket) return Promise.reject(new Error("Discord IPC is not connected"));
    const nonce = newNonce();
    const reply = new Promise((resolve, reject) => pending.set(nonce, { resolve, reject }));
    socket.write(encodeFrame(OP.FRAME, { cmd, args, nonce }));
    return withTimeout(reply, cmd).finally(() => pending.delete(nonce));
  }

  return Object.freeze({
    login,
    setActivity: (activity) => command("SET_ACTIVITY", { pid, activity: toIpcActivity(activity) }),
    clearActivity: () => command("SET_ACTIVITY", { pid }),
    async destroy() {
      const current = socket;
      if (!current) return;
      socket = undefined;
      for (const { reject } of pending.values()) reject(new Error("Discord IPC closed"));
      pending.clear();
      await new Promise((resolve) => { current.once("close", resolve); current.end(encodeFrame(OP.CLOSE, {})); setTimeout(() => { current.destroy(); resolve(); }, 1000).unref?.(); });
    },
  });
}
