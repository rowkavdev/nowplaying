import test from "node:test";
import assert from "node:assert/strict";
import { networkFailure } from "../src/setup-network-failure.js";
import { signInNavidrome } from "../src/provider-signin.js";
import { checkProviderConnection } from "../src/setup-connection.js";

const fetchFailed = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

test("tells a bad name, an untrusted certificate and a slow server apart (#141)", () => {
  assert.equal(networkFailure(fetchFailed("ENOTFOUND")), "name_not_found");
  assert.equal(networkFailure(fetchFailed("DEPTH_ZERO_SELF_SIGNED_CERT")), "tls_untrusted");
  assert.equal(networkFailure(fetchFailed("CERT_HAS_EXPIRED")), "tls_untrusted");
  assert.equal(networkFailure(fetchFailed("ERR_TLS_CERT_ALTNAME_INVALID")), "tls_untrusted");
  assert.equal(networkFailure(Object.assign(new Error("timed out"), { name: "TimeoutError" })), "timed_out");
  assert.equal(networkFailure(fetchFailed("ECONNREFUSED")), "unreachable");
  assert.equal(networkFailure(new Error("anything else")), "unreachable");
});

test("sign-in reports a self-signed certificate as such, not as unreachable", async () => {
  const fetchImpl = async () => { throw fetchFailed("SELF_SIGNED_CERT_IN_CHAIN"); };
  await assert.rejects(signInNavidrome({ baseUrl: "https://music.example.test", username: "rowan", password: "pw", fetchImpl }), { status: "tls_untrusted" });
});

test("Test connection reports a name that doesn't resolve", async () => {
  const result = await checkProviderConnection({ createProvider: () => ({ getPresence: async () => { throw fetchFailed("ENOTFOUND"); } }), config: {} });
  assert.deepEqual([result.ok, result.status], [false, "name_not_found"]);
});
