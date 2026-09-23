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

function whoProvider(user, { fail } = {}) {
  return () => ({
    async getPresence() { return { state: "idle" }; },
    async whoami() { if (fail) throw fail; return user; },
  });
}

test("passes when the server says the sign-in is the setup identity", async () => {
  const config = { identity: { id: "u1", displayName: "Rowan" } };
  assert.equal((await checkProviderConnection({ createProvider: whoProvider({ id: "u1", displayName: "rowan" }), config })).status, "connected");
  assert.equal((await checkProviderConnection({ createProvider: whoProvider({ id: null, displayName: "rowan" }), config })).status, "connected");
});

test("reports a user mismatch without echoing either user", async () => {
  const config = { identity: { id: "u1", displayName: "Rowan" } };
  const result = await checkProviderConnection({ createProvider: whoProvider({ id: "u2", displayName: "Guest" }), config });
  assert.deepEqual(result, { ok: false, status: "user_mismatch", activity: null });
  assert.equal(JSON.stringify(result).includes("Guest"), false);
});

test("user lookup: sign-in rejection fails, other lookup errors are ignored", async () => {
  const config = { identity: { id: "u1", displayName: "Rowan" } };
  const rejected = await checkProviderConnection({ createProvider: whoProvider(null, { fail: new Error("Jellyfin user request failed: 401 Unauthorized") }), config });
  const unsupported = await checkProviderConnection({ createProvider: whoProvider(null, { fail: new Error("Jellyfin user request failed: 400 Bad Request") }), config });
  assert.equal(rejected.status, "authentication_failed");
  assert.equal(unsupported.status, "connected");
});

test("skips the user check when there is no identity or no whoami", async () => {
  assert.equal((await checkProviderConnection({ createProvider: whoProvider({ id: "u2" }), config: {} })).status, "connected");
});
