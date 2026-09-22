import test from "node:test";
import assert from "node:assert/strict";
import { checkProviderConnection } from "../src/setup-connection.js";

function provider(result) {
  return () => ({ async getPresence() { return result; } });
}

function failingProvider(error) {
  return () => ({ async getPresence() { throw error; } });
}

test("accepts an idle response as a valid provider connection", async () => {
  assert.deepEqual(await checkProviderConnection({ createProvider: provider({ state: "idle" }), config: {} }), {
    ok: true,
    status: "connected",
    activity: "idle",
  });
});

test("classifies setup failures without exposing secrets", async () => {
  const invalid = await checkProviderConnection({
    createProvider() { throw new TypeError("token secret-value is invalid"); },
    config: { token: "secret-value" },
  });
  const auth = await checkProviderConnection({
    createProvider: failingProvider(new Error("Plex sessions request failed: 401 Unauthorized secret-value")),
    config: { token: "secret-value" },
  });
  const offline = await checkProviderConnection({
    createProvider: failingProvider(new TypeError("fetch failed secret-value")),
    config: { token: "secret-value" },
  });

  assert.deepEqual(invalid, { ok: false, status: "invalid_configuration", activity: null });
  assert.deepEqual(auth, { ok: false, status: "authentication_failed", activity: null });
  assert.deepEqual(offline, { ok: false, status: "unreachable", activity: null });
  assert.equal(JSON.stringify({ invalid, auth, offline }).includes("secret-value"), false);
});

test("uses a bounded fallback for other provider failures", async () => {
  assert.deepEqual(await checkProviderConnection({
    createProvider: failingProvider(new Error("unexpected response body")),
    config: {},
  }), { ok: false, status: "connection_failed", activity: null });
});
