import test from "node:test";
import assert from "node:assert/strict";
import { playbackTimes } from "../src/providers/fields.js";
import { createPlexProvider } from "../src/providers/plex.js";
import { createJellyfinProvider } from "../src/providers/jellyfin.js";
import { createEmbyProvider } from "../src/providers/emby.js";

const reply = (body) => async () => ({ ok: true, json: async () => body });

test("playbackTimes holds a position past the end at the end", () => {
  assert.deepEqual(playbackTimes(200_500, 200_000), { positionMs: 200_000, durationMs: 200_000 });
  assert.deepEqual(playbackTimes(5_000, 200_000), { positionMs: 5_000, durationMs: 200_000 });
});

test("playbackTimes treats a 0 or missing length as unknown", () => {
  assert.deepEqual(playbackTimes(5_000, 0), { positionMs: 5_000, durationMs: null });
  assert.deepEqual(playbackTimes(5_000, undefined), { positionMs: 5_000, durationMs: null });
  assert.deepEqual(playbackTimes(-1, "x"), { positionMs: null, durationMs: null });
});

test("Plex: a position just past the end of the track still reports playing", async () => {
  const provider = createPlexProvider({ baseUrl: "http://plex.test", token: "t", fetchImpl: reply({ MediaContainer: { Metadata: [
    { type: "track", title: "Song", viewOffset: 200_500, duration: 200_000, User: { username: "rowan" } },
  ] } }) });
  const presence = await provider.getPresence({ username: "rowan" });
  assert.equal(presence.state, "playing");
  assert.equal(presence.positionMs, 200_000);
  assert.equal(presence.durationMs, 200_000);
});

for (const [name, make] of [
  ["Jellyfin", (fetchImpl) => createJellyfinProvider({ baseUrl: "http://jf.test", apiKey: "k", fetchImpl })],
  ["Emby", (fetchImpl) => createEmbyProvider({ baseUrl: "http://emby.test", apiKey: "k", fetchImpl })],
]) {
  test(`${name}: live TV with a 0 length still reports playing`, async () => {
    const provider = make(reply([{ UserName: "rowan", NowPlayingItem: { Type: "Movie", Name: "Live", RunTimeTicks: 0 }, PlayState: { PositionTicks: 50_000_000 } }]));
    const presence = await provider.getPresence({ username: "rowan" });
    assert.equal(presence.state, "playing");
    assert.equal(presence.positionMs, 5_000);
    assert.equal(presence.durationMs, null);
  });
  test(`${name}: a position past the reported length still reports playing`, async () => {
    const provider = make(reply([{ UserName: "rowan", NowPlayingItem: { Type: "Audio", Name: "Song", RunTimeTicks: 1_000_000_000 }, PlayState: { PositionTicks: 1_020_000_000 } }]));
    const presence = await provider.getPresence({ username: "rowan" });
    assert.equal(presence.positionMs, 100_000);
    assert.equal(presence.durationMs, 100_000);
  });
}
