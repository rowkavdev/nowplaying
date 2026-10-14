import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithTimeout } from "../src/providers/request.js";

function trackedRedirect(cancels, location) {
  const body = new ReadableStream({ cancel() { cancels.count += 1; } });
  return new Response(body, { status: 302, headers: location === null ? {} : { location } });
}

test("followed redirect hop bodies are discarded", async () => {
  const cancels = { count: 0 };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) return trackedRedirect(cancels, `/hop${calls}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const response = await fetchWithTimeout(fetchImpl, "https://media.example.test/Sessions");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancels.count, 2);
});

for (const [mode, expectedCalls, matcher] of [
  ["loop", 4, /redirected too many times/],
  ["no-location", 1, /redirected without a location/],
  ["cross-origin", 1, /outside its origin/],
]) {
  test(`failing redirect reply bodies are discarded (${mode})`, async () => {
    const cancels = { count: 0 };
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const location = mode === "no-location" ? null : mode === "cross-origin" ? "https://other.invalid/x" : "/loop";
      return trackedRedirect(cancels, location);
    };
    await assert.rejects(fetchWithTimeout(fetchImpl, "https://media.example.test/Sessions"), matcher);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, expectedCalls);
    assert.equal(cancels.count, expectedCalls);
  });
}

for (const mode of ["throw", "reject", "pending"]) {
  test(`redirect cleanup ignores errors and does not await its promise (${mode})`, async () => {
    let discarded = false;
    const fetchImpl = async () => ({ status: 302, headers: { get: () => "https://other.invalid/x" }, body: { cancel() {
      discarded = true;
      if (mode === "throw") throw new Error("cleanup failed");
      if (mode === "reject") return Promise.reject(new Error("cleanup failed"));
      return new Promise(() => {});
    } } });
    await assert.rejects(fetchWithTimeout(fetchImpl, "https://media.example.test/Sessions"), /outside its origin/);
    assert.equal(discarded, true);
  });
}
