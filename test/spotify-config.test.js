import test from "node:test";
import assert from "node:assert/strict";
import { parseAppConfig } from "../src/app-config.js";
import { applyPrivacyChanges } from "../src/app-settings.js";
import { createCredentialStore } from "../src/credential-store.js";
import { serializeSetupConfig } from "../src/setup-config.js";

const BASE = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true };
const SPOTIFY = { clientId: "0123456789ABCDEF0123456789abcdef", identity: { id: "rowan-spotify", displayName: "Rowan" } };

test("config keeps a Spotify block beside the servers (#135)", () => {
  const text = serializeSetupConfig({ ...BASE, spotify: SPOTIFY });
  const saved = JSON.parse(text);
  assert.deepEqual(saved.spotify, {
    clientId: "0123456789abcdef0123456789abcdef",
    identity: { id: "rowan-spotify", displayName: "Rowan" },
    credentialRef: { provider: "spotify", identityId: "rowan-spotify" },
  });
  assert.equal(saved.servers.length, 1);
  assert.equal(saved.servers[0].provider, "jellyfin");
  const config = parseAppConfig(text);
  assert.equal(config.spotify.clientId, "0123456789abcdef0123456789abcdef");
  assert.equal(config.provider, "jellyfin");
});

test("configs without Spotify are unchanged", () => {
  const saved = JSON.parse(serializeSetupConfig(BASE));
  assert.equal("spotify" in saved, false);
  assert.equal(parseAppConfig(JSON.stringify(saved)).spotify, undefined);
});

test("bad or secret-bearing Spotify blocks are refused", () => {
  const good = JSON.parse(serializeSetupConfig({ ...BASE, spotify: SPOTIFY }));
  for (const spotify of [
    { ...good.spotify, clientId: "short" },
    { ...good.spotify, refreshToken: "r1" },
    { ...good.spotify, clientSecret: "s" },
    { ...good.spotify, credentialRef: { provider: "spotify", identityId: "someone-else" } },
    "spotify",
  ]) {
    assert.throws(() => parseAppConfig(JSON.stringify({ ...good, spotify })), /config/i);
  }
});

test("settings changes keep the Spotify connection", () => {
  const config = parseAppConfig(serializeSetupConfig({ ...BASE, spotify: SPOTIFY }));
  const next = applyPrivacyChanges(config, { hideArtwork: true });
  assert.equal(next.config.spotify.identity.id, "rowan-spotify");
  assert.equal(next.config.privacy.hideArtwork, true);
});

test("the credential store accepts the Spotify refresh token", async () => {
  const saved = new Map();
  const store = createCredentialStore({ adapter: {
    setPassword: async (s, a, v) => { saved.set(`${s}/${a}`, v); },
    getPassword: async (s, a) => saved.get(`${s}/${a}`) ?? null,
    deletePassword: async (s, a) => saved.delete(`${s}/${a}`),
  } });
  await store.save({ provider: "spotify", identityId: "rowan-spotify" }, "refresh");
  assert.equal(await store.read({ provider: "spotify", identityId: "rowan-spotify" }), "refresh");
  assert.deepEqual([...saved.keys()], ["nowplaying/spotify:rowan-spotify"]);
});
