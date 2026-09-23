import test from "node:test";
import assert from "node:assert/strict";

import { createHostedLoop } from "../src/hosted-loop.js";
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
