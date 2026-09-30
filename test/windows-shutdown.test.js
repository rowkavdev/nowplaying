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
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
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

test('backward wall-clock correction cannot extend graceful-stop wait (#789)', async () => {
  const realNow = Date.now;
  const realTimeout = globalThis.setTimeout;
  let wall = 100000, elapsed = 0, checks = 0;
  Date.now = () => wall;
  globalThis.setTimeout = (fn, ms) => { elapsed += ms; wall += ms; queueMicrotask(fn); return 0; };
  try {
    const result = await requestLocalShutdown({ port: 47832, token: 't', exitTimeoutMs: 30, pollMs: 10, elapsedNow: () => elapsed, fetchImpl: async (url) => {
      if (url.endsWith('/healthz')) {
        if (++checks === 2) wall -= 3600000;
        if (checks > 10) throw new Error('bounded fixture fallback');
      }
      return { status: 202 };
    } });
    assert.equal(result, 'unavailable');
    assert.equal(checks, 2);
    assert.equal(elapsed, 30);
  } finally { Date.now = realNow; globalThis.setTimeout = realTimeout; }
});

test('#815 a hanging health probe is not proof the listener stopped', async () => {
  const { createServer } = await import('node:http');
  const server = createServer((request, response) => { if (request.method === 'POST') { response.writeHead(202); response.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await requestLocalShutdown({ port: server.address().port, token: 'fixture', exitTimeoutMs: 1100, pollMs: 1 });
    assert.equal(result, 'unavailable');
    assert.equal(server.listening, true);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST' })).status, 202);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
