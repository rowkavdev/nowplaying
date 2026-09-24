import test from "node:test";
import assert from "node:assert/strict";
import { createPlexProvider } from "../src/providers/plex.js";
import { createJellyfinProvider } from "../src/providers/jellyfin.js";
import { createEmbyProvider } from "../src/providers/emby.js";
import { createNavidromeProvider } from "../src/providers/navidrome.js";

const reply = (body) => async () => ({ ok: true, json: async () => body });

for (const [name, make] of [
  ["Jellyfin", (fetchImpl) => createJellyfinProvider({ baseUrl: "http://jf.test", apiKey: "k", fetchImpl })],
  ["Emby", (fetchImpl) => createEmbyProvider({ baseUrl: "http://emby.test", apiKey: "k", fetchImpl })],
]) {
  test(`${name}: a playing session wins over the same user's paused one`, async () => {
    const provider = make(reply([
      { UserName: "rowan", UserId: "u1", NowPlayingItem: { Type: "Episode", Name: "TV left paused" }, PlayState: { IsPaused: true } },
      { UserName: "rowan", UserId: "u1", NowPlayingItem: { Type: "Audio", Name: "Phone playing" }, PlayState: { IsPaused: false } },
    ]));
    assert.equal((await provider.getPresence({ username: "rowan" })).title, "Phone playing");
    assert.equal((await provider.getPresence({ userId: "u1" })).title, "Phone playing");
  });
  test(`${name}: with only paused sessions the first one still shows`, async () => {
    const provider = make(reply([
      { UserName: "rowan", NowPlayingItem: { Type: "Audio", Name: "First" }, PlayState: { IsPaused: true } },
      { UserName: "rowan", NowPlayingItem: { Type: "Audio", Name: "Second" }, PlayState: { IsPaused: true } },
    ]));
    const presence = await provider.getPresence({ username: "rowan" });
    assert.equal(presence.title, "First");
    assert.equal(presence.state, "paused");
  });
  test(`${name}: a response that isn't a list is a clear error`, async () => {
    const provider = make(reply({ error: "Unauthorized" }));
    await assert.rejects(provider.getPresence(), new RegExp(`${name} sessions response was not a list`));
  });
}

test("Plex: a playing session wins over the same user's paused one", async () => {
  const provider = createPlexProvider({ baseUrl: "http://plex.test", token: "t", fetchImpl: reply({ MediaContainer: { Metadata: [
    { type: "episode", title: "TV left paused", User: { id: "7", username: "rowan" }, Player: { state: "paused" } },
    { type: "track", title: "Phone playing", User: { id: "7", username: "rowan" }, Player: { state: "playing" } },
  ] } }) });
  assert.equal((await provider.getPresence({ username: "rowan" })).title, "Phone playing");
  assert.equal((await provider.getPresence({ userId: "7" })).title, "Phone playing");
});

test("Plex: odd session lists don't throw TypeErrors", async () => {
  const withNull = createPlexProvider({ baseUrl: "http://plex.test", token: "t", fetchImpl: reply({ MediaContainer: { Metadata: [null, { type: "track", title: "Song", User: { username: "rowan" } }] } }) });
  assert.equal((await withNull.getPresence({ username: "rowan" })).title, "Song");
  const notList = createPlexProvider({ baseUrl: "http://plex.test", token: "t", fetchImpl: reply({ MediaContainer: { Metadata: { title: "x" } } }) });
  await assert.rejects(notList.getPresence(), /Plex sessions response was not a list/);
});

test("Navidrome: a single now-playing entry sent as an object still shows", async () => {
  const provider = createNavidromeProvider({ baseUrl: "http://nd.test", username: "u", token: "t", salt: "s", fetchImpl: reply({ "subsonic-response": { status: "ok", nowPlaying: { entry: { title: "Song", artist: "Band", username: "rowan" } } } }) });
  const presence = await provider.getPresence({ username: "rowan" });
  assert.equal(presence.title, "Song");
  assert.equal(presence.state, "playing");
});
