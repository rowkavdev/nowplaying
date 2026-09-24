import test from "node:test";
import assert from "node:assert/strict";
import { createSetupConfig, serializeSetupConfig } from "../src/setup-config.js";

const input = {
  provider: "plex",
  identity: { id: "user-42", displayName: "Rowan" },
  credentialStored: true,
};

test("creates a versioned config with a stable OS credential reference", () => {
  const config = createSetupConfig(input);
  assert.deepEqual(config, {
    version: 2,
    servers: [{ provider: "plex", identity: { id: "user-42", displayName: "Rowan" }, credentialRef: { provider: "plex", identityId: "user-42" } }],
    discord: { enabled: true, idleBehavior: "clear", artworkLookup: "off" },
  });
  assert.equal(config.provider, "plex");
  assert.deepEqual(config.credentialRef, { provider: "plex", identityId: "user-42" });
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
  assert.deepEqual(config.discord, { enabled: false, idleBehavior: "show", artworkLookup: "off" });
});

test("carries the album art lookup choice and refuses unknown lookups", () => {
  assert.equal(createSetupConfig({ ...input, discordArtworkLookup: "musicbrainz" }).discord.artworkLookup, "musicbrainz");
  assert.equal(createSetupConfig({ ...input, discordArtworkLookup: "off" }).discord.artworkLookup, "off");
  assert.throws(() => createSetupConfig({ ...input, discordArtworkLookup: true }), /discordArtworkLookup/);
  assert.throws(() => createSetupConfig({ ...input, discordArtworkLookup: "itunes" }), /discordArtworkLookup/);
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

test("takes a list of servers, one sign-in per account, 1 to 8 of them (#252)", () => {
  const jf = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "R" } };
  const nd = { provider: "navidrome", serverUrl: "http://127.0.0.1:4533", identity: { id: "u1", displayName: "R" } };
  const config = createSetupConfig({ servers: [jf, nd], credentialStored: true });
  assert.deepEqual(config.servers.map((s) => s.credentialRef), [{ provider: "jellyfin", identityId: "u1" }, { provider: "navidrome", identityId: "u1" }]);
  assert.throws(() => createSetupConfig({ servers: [jf, jf], credentialStored: true }), /same account twice/);
  assert.throws(() => createSetupConfig({ servers: [], credentialStored: true }), /1 to 8/);
  assert.throws(() => createSetupConfig({ servers: [{ ...jf, token: "x" }], credentialStored: true }), /not a setting/);
  assert.throws(() => createSetupConfig({ ...input, servers: [jf] }), /not both/);
});
