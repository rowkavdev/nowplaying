import test from "node:test";
import assert from "node:assert/strict";
import { createNavidromeProvider } from "../src/providers/navidrome.js";

test("maps a selected Navidrome now-playing entry", async () => {
  let requestUrl;
  const provider = createNavidromeProvider({
    baseUrl: "https://music.test/", username: "api-user", token: "hash", salt: "salt",
    fetchImpl: async (url) => {
      requestUrl = new URL(url);
      return { ok: true, json: async () => ({ "subsonic-response": { status: "ok", nowPlaying: { entry: [
        { username: "Sam", title: "Other" },
        { username: "Rowan", title: "Song", artist: "Artist", coverArt: "cover", duration: 180 },
      ] } } }) };
    },
  });
  const presence = await provider.getPresence({ username: "rowan" });
  assert.equal(requestUrl.pathname, "/rest/getNowPlaying.view");
  assert.equal(requestUrl.searchParams.get("u"), "api-user");
  assert.equal(presence.kind, "track");
  assert.equal(presence.title, "Song");
  assert.equal(presence.subtitle, "Artist");
  assert.equal(presence.durationMs, 180_000);
  assert.deepEqual(presence.artwork, {
    provider: "navidrome",
    itemId: null,
    imageId: "cover",
    imageTag: null,
    type: "cover",
  });
  assert.equal(presence.artworkUrl, null);
});

test("returns idle when nobody is playing", async () => {
  const provider = createNavidromeProvider({
    baseUrl: "https://music.test", username: "u", token: "t", salt: "s",
    fetchImpl: async () => ({ ok: true, json: async () => ({ "subsonic-response": { status: "ok" } }) }),
  });
  assert.equal((await provider.getPresence()).state, "idle");
});

test("surfaces Subsonic API errors", async () => {
  const provider = createNavidromeProvider({
    baseUrl: "https://music.test", username: "u", token: "t", salt: "s",
    fetchImpl: async () => ({ ok: true, json: async () => ({ "subsonic-response": { status: "failed", error: { message: "bad auth" } } }) }),
  });
  await assert.rejects(() => provider.getPresence(), /Navidrome API error: bad auth/);
});

test("whoami asks Navidrome for the signed-in user", async () => {
  let requestUrl;
  const provider = createNavidromeProvider({
    baseUrl: "https://music.test/", username: "rowan", token: "hash", salt: "salt",
    fetchImpl: async (url) => { requestUrl = new URL(url); return { ok: true, json: async () => ({ "subsonic-response": { status: "ok", user: { username: "rowan" } } }) }; },
  });
  assert.deepEqual(await provider.whoami(), { id: "rowan", displayName: "rowan" });
  assert.equal(requestUrl.pathname, "/rest/getUser.view");
  assert.equal(requestUrl.searchParams.get("username"), "rowan");
});

test("whoami maps a Navidrome wrong-credentials error to a sign-in rejection", async () => {
  const provider = createNavidromeProvider({
    baseUrl: "https://music.test/", username: "rowan", token: "hash", salt: "salt",
    fetchImpl: async () => ({ ok: true, json: async () => ({ "subsonic-response": { status: "failed", error: { code: 40, message: "Wrong username or password" } } }) }),
  });
  await assert.rejects(provider.whoami(), /request failed: 401/);
});

test("Navidrome says it is music-only, and the app keeps that through its wrappers (#143)", async () => {
  const { createProviderFromConfig, parseAppConfig } = await import("../src/app-config.js");
  const { serializeSetupConfig } = await import("../src/setup-config.js");
  const direct = createNavidromeProvider({ baseUrl: "https://music.test/", username: "u", token: "t", salt: "s", fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual([...direct.mediaKinds], ["track"]);
  const config = parseAppConfig(serializeSetupConfig({ provider: "navidrome", serverUrl: "https://music.test", identity: { id: "rowan", displayName: "rowan" }, credentialStored: true }));
  const app = createProviderFromConfig(config, JSON.stringify({ token: "t", salt: "s" }), { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual([...app.mediaKinds], ["track"]);
  const jellyfin = createProviderFromConfig(parseAppConfig(serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "R" }, credentialStored: true })), "k", { fetchImpl: async () => Response.json([]) });
  assert.deepEqual([...jellyfin.mediaKinds], ["track", "episode", "movie"]);
});
