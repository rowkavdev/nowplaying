import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OP, createDiscordIpcClient, decodeFrames, encodeFrame } from "../src/discord-ipc.js";

const APP = "123456789012345678";
const unix = { skip: process.platform === "win32" };

// A controllable fake Discord: the test drives exactly what the "Discord"
// side sends, including bytes no well-behaved client would ever send.
async function hostileDiscord(respond) {
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
        respond(socket, frame);
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(path, resolve));
  return {
    path, frames, sockets,
    send: (bytes) => { for (const socket of sockets) socket.write(bytes); },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); },
  };
}


async function waitUntil(check, label) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const ready = (socket, frame) => {
  if (frame.op === OP.HANDSHAKE) socket.write(encodeFrame(OP.FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
  if (frame.op === OP.FRAME) socket.write(encodeFrame(OP.FRAME, { cmd: frame.payload.cmd, nonce: frame.payload.nonce, data: {} }));
};

async function loggedIn(respond, options = {}) {
  const discord = await hostileDiscord(respond);
  const client = createDiscordIpcClient({ paths: [discord.path], timeoutMs: 300, ...options });
  await client.login({ clientId: APP });
  return { discord, client };
}

test("a malformed-JSON frame fails pending work and drops the connection", unix, async () => {
  const { discord, client } = await loggedIn(ready);
  const body = Buffer.from("{not json");
  const header = Buffer.alloc(8);
  header.writeInt32LE(OP.FRAME, 0);
  header.writeInt32LE(body.length, 4);
  const pending = client.setActivity({ details: "Song" });
  discord.send(Buffer.concat([header, body]));
  await assert.rejects(pending, /not JSON/);
  assert.equal(client.connected, false);
  await discord.close();
});

test("a frame with a bogus length fails pending work and drops the connection", unix, async () => {
  const { discord, client } = await loggedIn(ready);
  const header = Buffer.alloc(8);
  header.writeInt32LE(OP.FRAME, 0);
  header.writeInt32LE(128 * 1024, 4); // beyond the 64 KiB cap
  const pending = client.setActivity({ details: "Song" });
  discord.send(Buffer.concat([header, Buffer.alloc(16)]));
  await assert.rejects(pending, /invalid/);
  assert.equal(client.connected, false);
  await discord.close();
});

test("garbage on the socket before the handshake fails the login", unix, async () => {
  const discord = await hostileDiscord((socket, frame) => {
    if (frame.op === OP.HANDSHAKE) {
      const body = Buffer.from("garbage");
      const header = Buffer.alloc(8);
      header.writeInt32LE(OP.FRAME, 0);
      header.writeInt32LE(body.length, 4);
      socket.write(Buffer.concat([header, body]));
    }
  });
  const client = createDiscordIpcClient({ paths: [discord.path], timeoutMs: 300 });
  await assert.rejects(client.login({ clientId: APP }), /not JSON/);
  assert.equal(client.connected, false);
  await discord.close();
});

test("an unknown opcode is ignored and the client keeps working", unix, async () => {
  const { discord, client } = await loggedIn((socket, frame) => {
    ready(socket, frame);
    if (frame.op === OP.HANDSHAKE) socket.write(encodeFrame(99, { weird: true }));
  });
  await client.setActivity({ details: "Song" });
  assert.equal(client.connected, true);
  assert.equal(discord.frames.filter((f) => f.payload?.cmd === "SET_ACTIVITY").length, 1);
  await client.destroy();
  await discord.close();
});

test("a reply with somebody else's nonce does not resolve the command", unix, async () => {
  const { discord, client } = await loggedIn((socket, frame) => {
    if (frame.op === OP.HANDSHAKE) socket.write(encodeFrame(OP.FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
    if (frame.op === OP.FRAME) socket.write(encodeFrame(OP.FRAME, { cmd: frame.payload.cmd, nonce: "stolen", data: { evil: true } }));
  });
  await assert.rejects(client.setActivity({ details: "Song" }), /SET_ACTIVITY timed out/);
  assert.equal(client.connected, true);
  await client.destroy();
  await discord.close();
});

test("a ping before the handshake is answered and the login still completes", unix, async () => {
  const discord = await hostileDiscord((socket, frame) => {
    if (frame.op === OP.HANDSHAKE) {
      socket.write(encodeFrame(OP.PING, { early: true }));
      socket.write(encodeFrame(OP.FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
    }
  });
  const client = createDiscordIpcClient({ paths: [discord.path], timeoutMs: 1000 });
  try {
    await client.login({ clientId: APP });
    await waitUntil(() => discord.frames.some((f) => f.op === OP.PONG), "PONG frame");
    assert.deepEqual(discord.frames.find((f) => f.op === OP.PONG)?.payload, { early: true });
  } finally {
    await client.destroy();
    await discord.close();
  }
});

test("a close frame mid-command rejects the pending command with Discord's message", unix, async () => {
  const { discord, client } = await loggedIn((socket, frame) => {
    if (frame.op === OP.HANDSHAKE) socket.write(encodeFrame(OP.FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
    if (frame.op === OP.FRAME) socket.write(encodeFrame(OP.CLOSE, { code: 4000, message: "going away" }));
  });
  await assert.rejects(client.setActivity({ details: "Song" }), /Discord closed the connection: going away/);
  assert.equal(client.connected, false);
  await discord.close();
});

test("overlapping commands resolve by nonce even when replies arrive out of order", unix, async () => {
  const replies = [];
  const { discord, client } = await loggedIn((socket, frame) => {
    if (frame.op === OP.HANDSHAKE) socket.write(encodeFrame(OP.FRAME, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
    if (frame.op === OP.FRAME) {
      replies.push(frame);
      if (replies.length === 2) {
        // Answer the second command first.
        for (const reply of [...replies].reverse()) socket.write(encodeFrame(OP.FRAME, { cmd: reply.payload.cmd, nonce: reply.payload.nonce, data: {} }));
      }
    }
  });
  await Promise.all([client.setActivity({ details: "One" }), client.setActivity({ details: "Two" })]);
  assert.equal(discord.frames.filter((f) => f.payload?.cmd === "SET_ACTIVITY").length, 2);
  await client.destroy();
  await discord.close();
});

test("an oversized activity rejects cleanly and the connection keeps working (#634)", unix, async () => {
  const { discord, client } = await loggedIn(ready);
  try {
    // A synchronous throw here would fail assert.rejects outright.
    await assert.rejects(client.setActivity({ details: "x".repeat(70 * 1024) }), RangeError);
    assert.equal(client.connected, true, "the failed command never poisons the socket");
    await client.setActivity({ details: "Song" });
    assert.equal(discord.frames.filter((f) => f.payload?.cmd === "SET_ACTIVITY").length, 1, "only the valid activity hit the wire");
  } finally {
    // With the waiter leaked, this teardown crashed on an unhandled rejection.
    await client.destroy();
    await discord.close();
  }
});
