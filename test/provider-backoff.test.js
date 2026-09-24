import test from "node:test";
import assert from "node:assert/strict";
import { withProviderBackoff } from "../src/provider-backoff.js";

function flaky(results) {
  const calls = [];
  return { calls, provider: { id: "test", getPresence: async (...args) => { calls.push(args); const next = results.shift(); if (next instanceof Error) throw next; return next; } } };
}

test("backs off after failures, doubling up to the cap, and resets on success", async () => {
  let time = 0;
  const down = Object.assign(new Error("down"), { code: "ECONNREFUSED" });
  const { calls, provider } = flaky([down, down, down, down, { state: "idle" }, down]);
  const p = withProviderBackoff(provider, { baseMs: 1_000, maxMs: 4_000, random: () => 0, now: () => time });
  await assert.rejects(p.getPresence(), (error) => error === down);
  assert.deepEqual({ ...p.backoff() }, { failures: 1, nextRetryInMs: 1_000 });
  time = 999; await assert.rejects(p.getPresence(), (error) => error === down);
  assert.equal(calls.length, 1);
  time = 1_000; await assert.rejects(p.getPresence()); assert.equal(p.backoff().nextRetryInMs, 2_000);
  time = 3_000; await assert.rejects(p.getPresence()); assert.equal(p.backoff().nextRetryInMs, 4_000);
  time = 7_000; await assert.rejects(p.getPresence()); assert.equal(p.backoff().nextRetryInMs, 4_000);
  assert.equal(calls.length, 4);
  time = 11_000; assert.deepEqual(await p.getPresence(), { state: "idle" });
  assert.deepEqual({ ...p.backoff() }, { failures: 0, nextRetryInMs: 0 });
  await assert.rejects(p.getPresence()); assert.equal(p.backoff().nextRetryInMs, 1_000);
});

test("jitter only shortens the wait", async () => {
  const waits = [];
  for (const share of [0, 0.5, 1, 9]) {
    const { provider } = flaky([new Error("x")]);
    const p = withProviderBackoff(provider, { baseMs: 1_000, random: () => share, now: () => 0 });
    await assert.rejects(p.getPresence());
    waits.push(p.backoff().nextRetryInMs);
  }
  assert.deepEqual(waits, [1_000, 900, 800, 800]);
});

test("callers at the same moment share one request and pass arguments through", async () => {
  const { calls, provider } = flaky([{ state: "playing" }]);
  const p = withProviderBackoff(provider, { now: () => 0 });
  const [a, b] = await Promise.all([p.getPresence({ userId: "u1" }), p.getPresence({ userId: "u1" })]);
  assert.equal(a, b);
  assert.deepEqual(calls, [[{ userId: "u1" }]]);
  assert.equal(p.id, "test");
});

test("rejects bad options", () => {
  const { provider } = flaky([]);
  assert.throws(() => withProviderBackoff({}), TypeError);
  assert.throws(() => withProviderBackoff(provider, { baseMs: 10 }), RangeError);
  assert.throws(() => withProviderBackoff(provider, { baseMs: 5_000, maxMs: 1_000 }), RangeError);
  assert.throws(() => withProviderBackoff(provider, { jitter: 1 }), RangeError);
  assert.throws(() => withProviderBackoff(provider, { now: 1 }), TypeError);
});
