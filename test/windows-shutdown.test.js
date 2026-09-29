import test from "node:test";
import assert from "node:assert/strict";
import { requestLocalShutdown, STOP_EXIT } from "../src/windows-shutdown.js";

test("a refused connection means the app is not running", async () => {
  const outcome = await requestLocalShutdown({ port: 47832, token: "t", fetchImpl: async () => { throw new Error("fetch failed"); } });
  assert.equal(outcome, "not-running");
});

test("a timeout on the request is unavailable, not not-running", async () => {
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const outcome = await requestLocalShutdown({ port: 47832, token: "t", fetchImpl: async () => { throw timeout; } });
  assert.equal(outcome, "unavailable");
});

test("a non-202 reply is unavailable", async () => {
  for (const status of [401, 404, 500]) {
    const outcome = await requestLocalShutdown({ port: 47832, token: "t", fetchImpl: async () => ({ status }) });
    assert.equal(outcome, "unavailable", `status ${status}`);
  }
});

test("202 then the port going quiet is stopped", async () => {
  const calls = [];
  const outcome = await requestLocalShutdown({
    port: 47832,
    token: "t",
    pollMs: 1,
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) return { status: 202 };
      throw new Error("fetch failed");
    },
  });
  assert.equal(outcome, "stopped");
  assert.equal(calls.length, 2);
});

test("an app that stays up after 202 is unavailable", async () => {
  const outcome = await requestLocalShutdown({
    port: 47832,
    token: "t",
    pollMs: 1,
    exitTimeoutMs: 30,
    fetchImpl: async () => ({ status: 202 }),
  });
  assert.equal(outcome, "unavailable");
});

test("stop exit codes the installer relies on stay stable", () => {
  assert.deepEqual({ ...STOP_EXIT }, { stopped: 0, notRunning: 3, unavailable: 4 });
});
