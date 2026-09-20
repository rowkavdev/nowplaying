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
