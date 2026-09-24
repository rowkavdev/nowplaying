import test from "node:test";
import assert from "node:assert/strict";

import { createHostedLoop } from "../src/hosted-loop.js";
import { createPresence } from "../src/presence.js";
import { createHostedCredentials } from "../src/hosted-credentials.js";

function memoryAdapter() {
  const data = new Map();
  return {
    data,
    setPassword: async (service, account, secret) => { data.set(`${service}/${account}`, secret); },
    getPassword: async (service, account) => data.get(`${service}/${account}`) ?? null,
    deletePassword: async (service, account) => data.delete(`${service}/${account}`),
  };
}

const registration = { cardId: "a".repeat(22), deviceId: "b".repeat(22), token: "c".repeat(43) };

test("hosted credentials round-trip through the credential adapter", async () => {
  const adapter = memoryAdapter();
  const store = createHostedCredentials({ adapter });
  assert.equal(await store.load(), null);
  await store.save(registration);
  assert.deepEqual(await store.load(), registration);
  assert.deepEqual([...adapter.data.keys()], ["nowplaying/hosted:device"]);
  await store.clear();
  assert.equal(await store.load(), null);
});

test("hosted credentials reject bad data both ways", async () => {
  const adapter = memoryAdapter();
  const store = createHostedCredentials({ adapter });
  await assert.rejects(store.save({ ...registration, token: "short" }), TypeError);
  adapter.data.set("nowplaying/hosted:device", "not json");
  assert.equal(await store.load(), null);
  adapter.data.set("nowplaying/hosted:device", JSON.stringify({ ...registration, cardId: "../x" }));
  assert.equal(await store.load(), null);
  assert.throws(() => createHostedCredentials({ adapter: {} }), TypeError);
});

function manualTimers() {
  const queue = [];
  return { queue, setTimer: (fn) => { queue.push(fn); return queue.length; }, clearTimer: () => { queue.length = 0; } };
}

test("loop pushes each polled state to the uploader", async () => {
  const pushed = [];
  const timers = manualTimers();
  const loop = createHostedLoop({ getPresence: async () => ({ state: "playing" }), uploader: { push: async (p) => { pushed.push(p); return { sent: true }; } }, ...timers });
  loop.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pushed.length, 1);
  await timers.queue.shift()();
  assert.equal(pushed.length, 2);
  await loop.stop();
  assert.equal(timers.queue.length, 0);
});

test("provider and upload failures never throw out of the loop", async () => {
  const failing = createHostedLoop({ getPresence: async () => { throw new Error("down"); }, uploader: { push: async () => ({ sent: true }) } });
  assert.deepEqual(await failing.tick(), { sent: false, reason: "provider_error" });
  const broken = createHostedLoop({ getPresence: async () => ({ state: "idle" }), uploader: { push: async () => { throw new Error("boom"); } } });
  assert.deepEqual(await broken.tick(), { sent: false, reason: "upload_failed" });
  const empty = createHostedLoop({ getPresence: async () => null, uploader: { push: async () => ({ sent: true }) } });
  assert.deepEqual(await empty.tick(), { sent: false, reason: "no_presence" });
});

test("loop validates its inputs", () => {
  assert.throws(() => createHostedLoop({ uploader: { push() {} } }), TypeError);
  assert.throws(() => createHostedLoop({ getPresence() {} }), TypeError);
  assert.throws(() => createHostedLoop({ getPresence() {}, uploader: { push() {} }, intervalMs: 10 }), RangeError);
});

// #343: stale state on the hosted card.
function staleSetup({ presence }) {
  let clock = 1_800_000_000_000;
  const pushed = [];
  let next = presence;
  let result = { sent: true };
  const loop = createHostedLoop({
    getPresence: async () => { if (next instanceof Error) throw next; return next; },
    uploader: { push: async (p) => { pushed.push(p); return result; } },
    failAfterMs: 60_000, stuckAfterMs: 300_000, now: () => clock,
  });
  return {
    loop, pushed,
    set: (value) => { next = value; },
    setResult: (value) => { result = value; },
    advance: (ms) => { clock += ms; },
  };
}

const playingAt = (positionMs) => createPresence({ state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs, durationMs: 600_000 });

test("a provider failing past the timeout pushes idle once, not every poll", async () => {
  const env = staleSetup({ presence: playingAt(1000) });
  await env.loop.tick();
  env.set(new Error("down"));
  assert.equal((await env.loop.tick()).reason, "provider_error");
  env.advance(30_000);
  assert.equal((await env.loop.tick()).reason, "provider_error");
  env.advance(30_000);
  assert.equal((await env.loop.tick()).cleared, "provider_error");
  env.advance(15_000);
  await env.loop.tick();
  env.advance(15_000);
  await env.loop.tick();
  assert.deepEqual(env.pushed.map((p) => p.state), ["playing", "idle"]);
});

test("the failure idle is retried until it reaches the host", async () => {
  const env = staleSetup({ presence: new Error("down") });
  await env.loop.tick();
  env.advance(60_000);
  env.setResult({ sent: false, reason: "network_error" });
  await env.loop.tick();
  env.advance(15_000);
  env.setResult({ sent: true });
  await env.loop.tick();
  env.advance(15_000);
  await env.loop.tick();
  assert.deepEqual(env.pushed.map((p) => p.state), ["idle", "idle"]);
});

test("a recovered provider pushes real state again", async () => {
  const env = staleSetup({ presence: new Error("down") });
  await env.loop.tick();
  env.advance(60_000);
  await env.loop.tick();
  env.set(playingAt(5000));
  env.advance(15_000);
  await env.loop.tick();
  assert.deepEqual(env.pushed.map((p) => p.state), ["idle", "playing"]);
  // A later failure starts a fresh timeout.
  env.set(new Error("down again"));
  await env.loop.tick();
  env.advance(59_000);
  await env.loop.tick();
  assert.equal(env.pushed.length, 2);
  env.advance(1_000);
  await env.loop.tick();
  assert.equal(env.pushed.at(-1).state, "idle");
});

test("a playing session frozen at one position is uploaded as idle after the Discord timeout", async () => {
  const env = staleSetup({ presence: playingAt(42_000) });
  await env.loop.tick();
  env.advance(299_000);
  await env.loop.tick();
  assert.equal(env.pushed.at(-1).state, "playing");
  env.advance(1_000);
  assert.equal((await env.loop.tick()).cleared, "stuck");
  assert.equal(env.pushed.at(-1).state, "idle");
  env.set(playingAt(43_000));
  env.advance(15_000);
  await env.loop.tick();
  assert.equal(env.pushed.at(-1).state, "playing");
});

test("normal playback and paused sessions are never treated as stuck", async () => {
  const env = staleSetup({ presence: playingAt(0) });
  for (let i = 1; i <= 30; i += 1) {
    env.advance(15_000);
    env.set(playingAt(i * 15_000));
    await env.loop.tick();
  }
  env.set(createPresence({ state: "paused", kind: "track", title: "Song", positionMs: 1000, durationMs: 600_000 }));
  for (let i = 0; i < 30; i += 1) { env.advance(15_000); await env.loop.tick(); }
  assert.equal(env.pushed.some((p) => p.state === "idle"), false);
});
