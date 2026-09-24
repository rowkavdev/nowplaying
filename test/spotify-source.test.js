import test from "node:test";
import assert from "node:assert/strict";
import { combinePresence, createSpotifySource } from "../src/spotify-source.js";

const src = (value) => ({ getPresence: async () => { if (value instanceof Error) throw value; return value; } });
const serverSong = { state: "playing", title: "Server" };
const spotifySong = { state: "playing", title: "Spotify" };

test("whichever is playing wins, tie goes to prefer (#135)", async () => {
  assert.equal((await combinePresence({ primary: src(serverSong), secondary: src({ state: "idle" }) }).getPresence()).title, "Server");
  assert.equal((await combinePresence({ primary: src({ state: "idle" }), secondary: src(spotifySong) }).getPresence()).title, "Spotify");
  assert.equal((await combinePresence({ primary: src(serverSong), secondary: src(spotifySong) }).getPresence()).title, "Server");
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
    if (String(url).startsWith("https://accounts.spotify.com")) return { ok: true, status: 200, json: async () => ({ access_token: "a1", refresh_token: "r2", expires_in: 3600 }) };
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ is_playing: true, progress_ms: 1, currently_playing_type: "track", item: { name: "Song", duration_ms: 10, artists: [{ name: "A" }], album: { images: [] } } }) };
  };
  const config = { spotify: { clientId: "0123456789abcdef0123456789abcdef", identity: { id: "me" }, credentialRef: { provider: "spotify", identityId: "me" } } };
  const source = createSpotifySource(config, store, { fetchImpl });
  assert.equal((await source.getPresence()).title, "Song");
  assert.equal(saved.get("spotify:me"), "r2");
  assert.equal(typeof source.backoff, "function");
});
