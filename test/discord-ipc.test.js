import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OP, createDiscordIpcClient, decodeFrames, discordIpcPaths, encodeFrame, toIpcActivity } from "../src/discord-ipc.js";
import { createDiscordRpcTransport } from "../src/discord-rpc.js";

const APP = "123456789012345678";
const unix = { skip: process.platform === "win32" };

// A fake Discord: records frames and answers like the real client.
async function fakeDiscord({ onHandshake = "ready", onCommand = "ok" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "np-ipc-"));
  const path = join(dir, "discord-ipc-0");
  const frames = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeFrames(buffer);
      buffer = decoded.rest;
      for (const frame of decoded.frames) {
        frames.push(frame);
        if (frame.op === OP.HANDSHAKE && onHandshake === "ready") socket.write(encodeFrame(OP.FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
        if (frame.op === OP.HANDSHAKE && onHandshake === "close") socket.write(encodeFrame(OP.CLOSE, { code: 4000, message: "Invalid Client ID" }));
        if (frame.op === OP.FRAME && onCommand === "ok") socket.write(encodeFrame(OP.FRAME, { cmd: frame.payload.cmd, nonce: frame.payload.nonce, data: {} }));
        if (frame.op === OP.FRAME && onCommand === "error") socket.write(encodeFrame(OP.FRAME, { cmd: frame.payload.cmd, evt: "ERROR", nonce: frame.payload.nonce, data: { message: "bad activity" } }));
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(path, resolve));
  return {
    path, frames, sockets,
    close: () => { for (const socket of sockets) socket.destroy(); return new Promise((resolve) => server.close(resolve)); },
  };
}

test("frames round-trip, split across chunks", () => {
  const bytes = Buffer.concat([encodeFrame(OP.FRAME, { a: 1 }), encodeFrame(OP.PING, { b: "é" })]);
  const first = decodeFrames(bytes.subarray(0, 17));
  assert.deepEqual(first.frames, [{ op: OP.FRAME, payload: { a: 1 } }]);
  const rest = decodeFrames(Buffer.concat([first.rest, bytes.subarray(17)]));
  assert.deepEqual(rest.frames, [{ op: OP.PING, payload: { b: "é" } }]);
  assert.throws(() => decodeFrames(Buffer.from([1, 0, 0, 0, 255, 255, 255, 127])), /invalid/);
});

test("finds the socket per platform", () => {
  assert.equal(discordIpcPaths({ platform: "win32" })[0], "\\\\?\\pipe\\discord-ipc-0");
  assert.equal(discordIpcPaths({ platform: "linux", env: { XDG_RUNTIME_DIR: "/run/user/1000" } })[9], join("/run/user/1000", "discord-ipc-9"));
});

test("maps the activity onto Discord's wire shape", () => {
  assert.deepEqual(toIpcActivity({ type: "listening", details: "Song", state: "Artist", largeImageKey: "https://img/x.png", largeImageText: "Album", smallImageKey: "play", startTimestamp: 100, endTimestamp: 200 }), {
    type: 2, details: "Song", state: "Artist", timestamps: { start: 100000, end: 200000 }, assets: { large_image: "https://img/x.png", large_text: "Album", small_image: "play" },
  });
  assert.throws(() => toIpcActivity({ type: "streaming" }), /not supported/);
});

test("handshakes, sets and clears the activity, answers pings, and closes", unix, async () => {
  const discord = await fakeDiscord();
  let n = 0;
  const client = createDiscordIpcClient({ paths: [join(discord.path, "..", "missing"), discord.path], pid: 4242, newNonce: () => `n${n += 1}` });
  try {
    await client.login({ clientId: APP });
    assert.deepEqual(discord.frames[0], { op: OP.HANDSHAKE, payload: { v: 1, client_id: APP } });
    await client.setActivity({ type: "watching", details: "Film" });
    await client.clearActivity();
    assert.deepEqual(discord.frames.slice(1).map((f) => f.payload), [
      { cmd: "SET_ACTIVITY", args: { pid: 4242, activity: { type: 3, details: "Film" } }, nonce: "n1" },
      { cmd: "SET_ACTIVITY", args: { pid: 4242 }, nonce: "n2" },
    ]);
    const [socket] = discord.sockets;
    socket.write(encodeFrame(OP.PING, { t: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(discord.frames.at(-1), { op: OP.PONG, payload: { t: 1 } });
    await client.destroy();
    assert.equal(discord.frames.at(-1).op, OP.CLOSE);
    await assert.rejects(client.setActivity({ details: "x" }), /not connected/);
  } finally {
    await discord.close();
  }
});

test("reports Discord not running, a rejected app id and a rejected command", unix, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-ipc-"));
  await assert.rejects(createDiscordIpcClient({ paths: [join(dir, "discord-ipc-0")] }).login({ clientId: APP }), /not running/);
  await assert.rejects(createDiscordIpcClient({ paths: [] }).login({ clientId: "nope" }), /application ID/);

  const closing = await fakeDiscord({ onHandshake: "close" });
  try {
    await assert.rejects(createDiscordIpcClient({ paths: [closing.path] }).login({ clientId: APP }), /Invalid Client ID/);
  } finally { await closing.close(); }

  const silent = await fakeDiscord({ onHandshake: "none" });
  try {
    await assert.rejects(createDiscordIpcClient({ paths: [silent.path], timeoutMs: 100 }).login({ clientId: APP }), /handshake timed out/);
  } finally { await silent.close(); }

  const erroring = await fakeDiscord({ onCommand: "error" });
  const client = createDiscordIpcClient({ paths: [erroring.path] });
  try {
    await client.login({ clientId: APP });
    await assert.rejects(client.setActivity({ details: "x" }), /bad activity/);
  } finally { await client.destroy(); await erroring.close(); }
});

test("a dropped connection fails pending work so the transport can reconnect", unix, async () => {
  const discord = await fakeDiscord({ onCommand: "none" });
  const transport = createDiscordRpcTransport({ clientId: APP, createClient: async () => createDiscordIpcClient({ paths: [discord.path], timeoutMs: 2000 }) });
  try {
    await transport.connect();
    const pending = transport.setActivity({ details: "Song" });
    for (const socket of discord.sockets) socket.destroy();
    await assert.rejects(pending, /closed/);
  } finally {
    await transport.close();
    await discord.close();
  }
});

test("works over a real Windows named pipe", { skip: process.platform !== "win32" }, async () => {
  const path = `\\\\?\\pipe\\np-discord-ipc-test-${process.pid}`;
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeFrames(buffer);
      buffer = decoded.rest;
      for (const frame of decoded.frames) {
        if (frame.op === OP.HANDSHAKE) socket.write(encodeFrame(OP.FRAME, { cmd: "DISPATCH", evt: "READY", data: {} }));
        if (frame.op === OP.FRAME) socket.write(encodeFrame(OP.FRAME, { cmd: frame.payload.cmd, nonce: frame.payload.nonce, data: {} }));
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(path, resolve));
  const client = createDiscordIpcClient({ paths: [path] });
  try {
    await client.login({ clientId: APP });
    await client.setActivity({ type: "listening", details: "Song" });
    await client.clearActivity();
  } finally {
    await client.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("sends the same status again after Discord restarts", unix, async () => {
  const { createDiscordClient } = await import("../src/discord-client.js");
  const first = await fakeDiscord();
  const second = await fakeDiscord();
  const ipc = createDiscordIpcClient({ paths: [first.path, second.path], timeoutMs: 1000 });
  const transport = createDiscordRpcTransport({ clientId: APP, createClient: async () => ipc });
  const client = createDiscordClient({ transport, minUpdateIntervalMs: 0, retryDelayMs: 100 });
  const sets = (d) => d.frames.filter((f) => f.op === OP.FRAME && f.payload.cmd === "SET_ACTIVITY" && f.payload.args.activity).length;
  try {
    assert.equal(await client.publish({ details: "Song" }), true);
    assert.equal(sets(first), 1);
    assert.equal(ipc.connected, true);
    await first.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(ipc.connected, false);
    assert.equal(transport.connected, false);
    assert.equal(await client.publish({ details: "Song" }), true);
    assert.equal(sets(second), 1);
    assert.equal(client.connected, true);
  } finally {
    await client.close();
    await second.close();
  }
});
