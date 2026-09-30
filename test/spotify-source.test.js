import { streamJsonFixture } from "./helpers/stream-json-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { combinePresence, createSpotifySource } from "../src/spotify-source.js";

const src = (value) => ({ getPresence: async () => { if (value instanceof Error) throw value; return value; } });
const serverSong = { state: "playing", title: "Server" };
const spotifySong = { state: "playing", title: "Spotify" };

test("whichever is playing wins, tie goes to prefer when set (#135)", async () => {
  assert.equal((await combinePresence({ primary: src(serverSong), secondary: src({ state: "idle" }) }).getPresence()).title, "Server");
  assert.equal((await combinePresence({ primary: src({ state: "idle" }), secondary: src(spotifySong) }).getPresence()).title, "Spotify");
  assert.equal((await combinePresence({ primary: src(serverSong), secondary: src(spotifySong), prefer: "server" }).getPresence()).title, "Server");
  assert.equal((await combinePresence({ primary: src(serverSong), secondary: src(spotifySong), prefer: "spotify" }).getPresence()).title, "Spotify");
  assert.equal((await combinePresence({ primary: src({ state: "paused", title: "P" }), secondary: src({ state: "paused", title: "S" }) }).getPresence()).title, "P");
});

test("one side failing doesn't hide the other", async () => {
  const down = new Error("down");
  assert.equal((await combinePresence({ primary: src(down), secondary: src(spotifySong) }).getPresence()).title, "Spotify");
  assert.equal((await combinePresence({ primary: src({ state: "idle" }), secondary: src(new Error("429")) }).getPresence()).state, "idle");
  await assert.rejects(combinePresence({ primary: src(down), secondary: src({ state: "idle" }) }).getPresence(), (e) => e === down);
  assert.throws(() => combinePresence({ primary: src(serverSong), secondary: src(spotifySong), prefer: "x" }), /prefer/);
});

test("Spotify source reads and saves the refresh token through the credential store", async () => {
  assert.equal(createSpotifySource({}, {}), null);
  const saved = new Map([["spotify:me", "r1"]]);
  const store = { read: async (ref) => saved.get(`${ref.provider}:${ref.identityId}`), save: async (ref, v) => { saved.set(`${ref.provider}:${ref.identityId}`, v); } };
  const fetchImpl = async (url) => {
    if (new URL(url).hostname === "accounts.spotify.com") return streamJsonFixture({ ok: true, status: 200, json: async () => ({ access_token: "a1", refresh_token: "r2", expires_in: 3600 }) });
    return streamJsonFixture({ ok: true, status: 200, headers: new Headers(), json: async () => ({ is_playing: true, progress_ms: 1, currently_playing_type: "track", item: { name: "Song", duration_ms: 10, artists: [{ name: "A" }], album: { images: [] } } }) });
  };
  const config = { spotify: { clientId: "0123456789abcdef0123456789abcdef", identity: { id: "me" }, credentialRef: { provider: "spotify", identityId: "me" } } };
  const source = createSpotifySource(config, store, { fetchImpl });
  assert.equal((await source.getPresence()).title, "Song");
  assert.equal(saved.get("spotify:me"), "r2");
  assert.equal(typeof source.backoff, "function");
});

test("by default the most recently started side wins when both play (Rowan's call)", async () => {
  let server = { state: "playing", title: "Server A" };
  let spotify = { state: "idle" };
  const card = combinePresence({ primary: { getPresence: async () => server }, secondary: { getPresence: async () => spotify } });
  assert.equal((await card.getPresence()).title, "Server A");
  spotify = { state: "playing", title: "Spotify B" };
  assert.equal((await card.getPresence()).title, "Spotify B");
  assert.equal((await card.getPresence()).title, "Spotify B");
  server = { state: "playing", title: "Server C" };
  assert.equal((await card.getPresence()).title, "Server C");
  spotify = { state: "paused", title: "Spotify B" };
  assert.equal((await card.getPresence()).title, "Server C");
  spotify = { state: "playing", title: "Spotify B" };
  assert.equal((await card.getPresence()).title, "Spotify B");
});

test("server's newer item wins over Spotify after a backward wall-clock correction", async () => {
  let wall = 1_800_000_000_000;
  let server = { state: "playing", kind: "track", title: "Server old" };
  let spotify = { state: "idle" };
  const card = combinePresence({ primary: { getPresence: async () => server }, secondary: { getPresence: async () => spotify } });
  assert.equal((await card.getPresence()).title, "Server old");
  wall += 1000;
  spotify = { state: "playing", kind: "track", title: "Spotify newer" };
  assert.equal((await card.getPresence()).title, "Spotify newer");
  wall -= 60 * 60_000;
  wall += 1000;
  assert.equal((await card.getPresence()).title, "Spotify newer", "unchanged tracks do not reset priority");
  server = { state: "playing", kind: "track", title: "Server latest after rollback" };
  assert.equal((await card.getPresence()).title, "Server latest after rollback");
  assert.ok(wall < 1_800_000_000_000);
  spotify = { state: "paused", kind: "track", title: "Spotify newer" };
  assert.equal((await card.getPresence()).title, "Server latest after rollback");
  spotify = { state: "playing", kind: "track", title: "Spotify newer" };
  assert.equal((await card.getPresence()).title, "Spotify newer", "resume counts as newer activity");
});

test("a 401 from Spotify drops the cached access token so the next poll refreshes", async () => {
  const saved = new Map([["spotify:me", "r1"]]);
  const store = { read: async (ref) => saved.get(`${ref.provider}:${ref.identityId}`), save: async (ref, v) => { saved.set(`${ref.provider}:${ref.identityId}`, v); } };
  let refreshes = 0;
  const fetchImpl = async (url, init) => {
    if (new URL(url).hostname === "accounts.spotify.com") { refreshes += 1; return streamJsonFixture({ ok: true, status: 200, json: async () => ({ access_token: `a${refreshes}`, expires_in: 3600 }) }); }
    // The first token was revoked server-side; only a fresh one works.
    if (init.headers.Authorization === "Bearer a1") return streamJsonFixture({ ok: false, status: 401, headers: new Headers(), json: async () => ({}) });
    return streamJsonFixture({ ok: true, status: 200, headers: new Headers(), json: async () => ({ is_playing: true, currently_playing_type: "track", item: { name: "Song", artists: [], album: { images: [] } } }) });
  };
  const config = { spotify: { clientId: "0123456789abcdef0123456789abcdef", identity: { id: "me" }, credentialRef: { provider: "spotify", identityId: "me" } } };
  let clock = 0;
  const source = createSpotifySource(config, store, { fetchImpl, backoff: { elapsedNow: () => clock } });
  await assert.rejects(source.getPresence(), (error) => error.status === 401);
  clock += 10 * 60_000; // past the backoff wait, well inside the token's hour
  assert.equal((await source.getPresence()).title, "Song");
  assert.equal(refreshes, 2);
});

test("a revoked refresh token reads as a sign-in problem, not a generic error", async () => {
  const { refreshAccessToken } = await import("../src/spotify-auth.js");
  const fetchImpl = async () => (streamJsonFixture({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) }));
  await assert.rejects(refreshAccessToken({ clientId: "0123456789abcdef0123456789abcdef", refreshToken: "r", fetchImpl }), (error) => error.code === "reauth_needed" && error.status === 401);
});
