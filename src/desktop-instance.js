import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const INSTANCE_PATH = "/api/desktop-instance";
const SECRET = /^[a-f0-9]{64}$/;
const CHALLENGE = /^[a-f0-9]{32}$/;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DesktopInstanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "DesktopInstanceError";
    this.startupCode = "INSTANCE_IDENTITY_UNAVAILABLE";
  }
}

export class AlreadyRunningError extends Error {
  constructor(url) {
    super("NowPlaying is already running.");
    this.url = url;
  }
}

// Independent of the device ID (which media servers see). Exclusive create
// lets simultaneous desktop launches use one private, stable install secret.
export async function loadDesktopInstanceSecret(file) {
  const unavailable = () => new DesktopInstanceError("NowPlaying couldn't access its local instance identity. Check permissions for its data folder and retry.");
  try { await mkdir(dirname(file), { recursive: true, mode: 0o700 }); }
  catch { throw unavailable(); }
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const existing = (await readFile(file, "utf8")).trim();
      if (SECRET.test(existing)) return existing;
      // A concurrent writer may have created its file but not finished yet.
      if (existing) throw new DesktopInstanceError("NowPlaying's local instance identity is damaged. Remove the desktop-instance-secret file from the app data folder and restart.");
    } catch (error) {
      if (error instanceof DesktopInstanceError) throw error;
      if (error.code !== "ENOENT") throw unavailable();
      const secret = randomBytes(32).toString("hex");
      try {
        await writeFile(file, `${secret}\n`, { flag: "wx", mode: 0o600 });
        return secret;
      } catch (writeError) {
        if (writeError.code !== "EEXIST") throw unavailable();
      }
    }
    await pause(10);
  }
  throw new DesktopInstanceError("NowPlaying's local instance identity is not ready. Try starting again; if this persists, remove the desktop-instance-secret file from the app data folder.");
}

export function withDesktopInstance(handler, secret) {
  if (!SECRET.test(secret)) throw new TypeError("desktop instance secret is invalid");
  return (request) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== INSTANCE_PATH) return handler(request);
    const challenge = url.searchParams.get("challenge");
    if (!CHALLENGE.test(challenge ?? "")) return { status: 400, headers: {}, body: "Invalid challenge" };
    return {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app: "NowPlaying", proof: proof(secret, challenge) }),
    };
  };
}

// A local listener must prove it belongs to this install before a launcher
// opens its page. Only a random challenge is sent; the private secret and
// session cookie never travel to a possibly unrelated process.
export async function findDesktopInstance({ port, secret, fetchImpl = fetch, attempts = 1 } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError("desktop instance port is invalid");
  if (!SECRET.test(secret)) throw new TypeError("desktop instance secret is invalid");
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const challenge = randomBytes(16).toString("hex");
    try {
      const response = await fetchImpl(`${origin}${INSTANCE_PATH}?challenge=${challenge}`, { redirect: "error", signal: AbortSignal.timeout(500) });
      if (response.ok && /^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
        const body = await limitedJson(response);
        const expected = Buffer.from(proof(secret, challenge));
        const actual = Buffer.from(typeof body.proof === "string" ? body.proof : "");
        if (body.app === "NowPlaying" && actual.length === expected.length && timingSafeEqual(actual, expected)) return origin;
      } else cancelBody(response.body);
    } catch { /* Busy, starting, or an unrelated listener: never trust it. */ }
    if (attempt + 1 < attempts) await pause(50);
  }
  return null;
}

function proof(secret, challenge) {
  return createHmac("sha256", secret).update(`nowplaying-desktop:${challenge}`).digest("hex");
}

function cancelBody(target) {
  try { Promise.resolve(target?.cancel?.()).catch(() => {}); } catch {}
}

async function limitedJson(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) throw new Error("Instance response too large");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    cancelBody(reader);
    try { reader.releaseLock?.(); } catch { /* Cleanup must not change identity validation. */ }
  }
}
