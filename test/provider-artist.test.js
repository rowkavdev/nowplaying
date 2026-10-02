import { streamJsonFixture } from "./helpers/stream-json-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createJellyfinProvider } from "../src/providers/jellyfin.js";
import { createEmbyProvider } from "../src/providers/emby.js";
import { createPlexProvider } from "../src/providers/plex.js";
import { createNavidromeProvider } from "../src/providers/navidrome.js";
import { createSpotifyProvider } from "../src/providers/spotify.js";

const json = (body) => async () => streamJsonFixture({ ok: true, json: async () => body });

test("Jellyfin and Emby report the track artist and the provider id; episodes have no artist", async () => {
  const audio = [{ UserName: "Rowan", PlayState: {}, NowPlayingItem: { Id: "1", Type: "Audio", Name: "Song", Artists: ["A", "B"], AlbumArtist: "Various" } }];
  const episode = [{ UserName: "Rowan", PlayState: {}, NowPlayingItem: { Id: "2", Type: "Episode", Name: "Pilot", SeriesName: "Show" } }];
  for (const [make, id] of [[createJellyfinProvider, "jellyfin"], [createEmbyProvider, "emby"]]) {
    const track = await make({ baseUrl: "https://s.test", apiKey: "k", fetchImpl: json(audio) }).getPresence({ username: "rowan" });
    assert.equal(track.artist, "A, B");
    assert.equal(track.provider, id);
    const ep = await make({ baseUrl: "https://s.test", apiKey: "k", fetchImpl: json(episode) }).getPresence({ username: "rowan" });
    assert.equal(ep.artist, null);
  }
});

test("Plex reports the track artist, not the album", async () => {
  const body = { MediaContainer: { Metadata: [{ title: "Song", type: "track", grandparentTitle: "Band", parentTitle: "Album", User: { username: "Rowan" }, Player: { state: "playing" } }] } };
  const presence = await createPlexProvider({ baseUrl: "http://plex.test/", token: "t", fetchImpl: json(body) }).getPresence({ username: "rowan" });
  assert.equal(presence.artist, "Band");
  assert.equal(presence.provider, "plex");
});

test("Navidrome keeps artist empty when only an album is known, while subtitle still falls back", async () => {
  const body = { "subsonic-response": { status: "ok", nowPlaying: { entry: [{ username: "Rowan", title: "Song", album: "Album Only" }] } } };
  const presence = await createNavidromeProvider({ baseUrl: "https://m.test/", username: "u", token: "t", salt: "s", fetchImpl: json(body) }).getPresence({ username: "rowan" });
  assert.equal(presence.subtitle, "Album Only");
  assert.equal(presence.artist, null);
  assert.equal(presence.provider, "navidrome");
});

test("Spotify reports artists for a track, none for a podcast episode, and never the album", async () => {
  const make = (item, type) => createSpotifyProvider({ getAccessToken: async () => "a", fetchImpl: async () => streamJsonFixture({ status: 200, ok: true, headers: new Headers(), json: async () => ({ is_playing: true, currently_playing_type: type, item }) }) });
  const track = await make({ name: "Song", artists: [{ name: "A" }, { name: "B" }], album: { name: "Album" } }, "track").getPresence();
  assert.equal(track.artist, "A, B");
  assert.equal(track.provider, "spotify");
  const noArtist = await make({ name: "Song", artists: [], album: { name: "Album" } }, "track").getPresence();
  assert.equal(noArtist.artist, null);
  const episode = await make({ name: "Ep", show: { name: "Podcast" } }, "episode").getPresence();
  assert.equal(episode.artist, null);
});
