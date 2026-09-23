import test from "node:test";
import assert from "node:assert/strict";
import { createSetupConfig, serializeSetupConfig } from "../src/setup-config.js";

const input = {
  provider: "plex",
  identity: { id: "user-42", displayName: "Rowan" },
  credentialStored: true,
};

test("creates a versioned config with a stable OS credential reference", () => {
  assert.deepEqual(createSetupConfig(input), {
    version: 1,
    provider: "plex",
    identity: { id: "user-42", displayName: "Rowan" },
    credentialRef: { provider: "plex", identityId: "user-42" },
    discord: { enabled: true, idleBehavior: "clear" },
  });
});

test("serializes review output without credentials", () => {
  const serialized = serializeSetupConfig(input);
  assert.deepEqual(JSON.parse(serialized), createSetupConfig(input));
  for (const forbidden of ["secret-token", "apiKey", "token", "credential\""]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("carries reviewed Discord choices", () => {
  const config = createSetupConfig({
    ...input,
    discordEnabled: false,
    discordIdleBehavior: "show",
  });
  assert.deepEqual(config.discord, { enabled: false, idleBehavior: "show" });
});

test("requires stable identity and a stored credential", () => {
  assert.throws(() => createSetupConfig({ ...input, identity: { id: "", displayName: "Rowan" } }), /identity.id is required/);
  assert.throws(() => createSetupConfig({ ...input, credentialStored: false }), /requires a stored credential/);
});

test("refuses raw credentials and unsupported providers", () => {
  assert.throws(() => createSetupConfig({ ...input, token: "secret-token" }), /cannot contain credentials/);
  assert.throws(() => createSetupConfig({ ...input, provider: "other" }), /provider is invalid/);
});

test("carries the server address and refuses one with credentials in it", () => {
  assert.equal(createSetupConfig({ ...input, serverUrl: "http://127.0.0.1:32400" }).serverUrl, "http://127.0.0.1:32400");
  for (const bad of ["ftp://x", "http://u:p@x", "http://x/?token=1", "not a url", 5]) {
    assert.throws(() => createSetupConfig({ ...input, serverUrl: bad }), /serverUrl is invalid/);
  }
});
