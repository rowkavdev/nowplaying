import test from "node:test";
import assert from "node:assert/strict";
import { createSpotifyProvider } from "../src/providers/spotify.js";

function reply(status, body, headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), json: async () => body };
}

function provider(res, token = "access") {
  const calls = [];
  const p = createSpotifyProvider({ getAccessToken: async () => token, fetchImpl: async (url, init) => { calls.push({ url, init }); return res; } });
  return { p, calls };
}

const track = {
  is_playing: true, progress_ms: 61_000, currently_playing_type: "track",
  item: { name: "Song", duration_ms: 200_000, artists: [{ name: "A" }, { name: "B" }], album: { name: "Album", images: [
    { url: "https://i.scdn.co/image/small", width: 64 }, { url: "https://i.scdn.co/image/big", width: 640 },
  ] } },
};

test("maps a playing Spotify track (#135)", async () => {
  const { p, calls } = provider(reply(200, track));
  const presence = await p.getPresence();
  assert.equal(new URL(calls[0].url).pathname, "/v1/me/player/currently-playing");
  assert.equal(calls[0].init.headers.Authorization, "Bearer access");
  assert.equal(presence.state, "playing");
  assert.equal(presence.kind, "track");
  assert.equal(presence.title, "Song");
  assert.equal(presence.subtitle, "A, B");
  assert.equal(presence.artworkUrl, "https://i.scdn.co/image/big");
  assert.equal(presence.positionMs, 61_000);
  assert.equal(presence.durationMs, 200_000);
  assert.deepEqual([...p.mediaKinds], ["track"]);
});

test("paused, nothing playing, ads and local files", async () => {
  assert.equal((await provider(reply(200, { ...track, is_playing: false })).p.getPresence()).state, "paused");
  assert.equal((await provider(reply(204)).p.getPresence()).state, "idle");
  assert.equal((await provider(reply(200, { is_playing: true, currently_playing_type: "ad", item: null })).p.getPresence()).state, "idle");
  const local = await provider(reply(200, { ...track, item: { name: "Rip", is_local: true, duration_ms: 1000, artists: [], album: { name: "Mine", images: [] } }, progress_ms: 5000 })).p.getPresence();
  assert.equal(local.title, "Rip");
  assert.equal(local.subtitle, "Mine");
  assert.equal(local.artworkUrl, null);
  assert.equal(local.positionMs, 1000);
});

test("podcast episodes are Listening, never TV", async () => {
  const presence = await provider(reply(200, { is_playing: true, progress_ms: 0, currently_playing_type: "episode",
    item: { name: "Ep 12", duration_ms: 3_600_000, show: { name: "The Pod" }, images: [{ url: "https://i.scdn.co/image/ep", width: 300 }] } })).p.getPresence();
  assert.equal(presence.kind, "track");
  assert.equal(presence.title, "Ep 12");
  assert.equal(presence.subtitle, "The Pod");
  assert.equal(presence.series, null);
  assert.equal(presence.artworkUrl, "https://i.scdn.co/image/ep");
});

test("expired sign-in and rate limits fail without leaking the token", async () => {
  await assert.rejects(provider(reply(401, {})).p.getPresence(), (error) => /401/.test(error.message) && !/access/.test(error.message));
  await assert.rejects(provider(reply(200, track), null).p.getPresence(), /401/);
  await assert.rejects(provider(reply(429, {}, { "retry-after": "7" })).p.getPresence(), (error) => error.retryAfterMs === 7000);
  assert.throws(() => createSpotifyProvider({}), /getAccessToken/);
});
