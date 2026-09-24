import test from "node:test";
import assert from "node:assert/strict";
import { createPlexProvider } from "../src/providers/plex.js";

test("polls and maps the selected Plex user session", async () => {
  let request;
  const provider = createPlexProvider({
    baseUrl: "http://plex.test/",
    token: "secret",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        async json() {
          return { MediaContainer: { Metadata: [
            { title: "Other", type: "movie", User: { title: "Sam" } },
            {
              title: "Arrival", type: "movie", year: 2016, viewOffset: 5, duration: 10,
              thumb: "/library/metadata/1/thumb", User: { username: "Rowan" },
              Player: { state: "paused" },
            },
          ] } };
        },
      };
    },
  });

  const presence = await provider.getPresence({ username: "rowan" });
  assert.equal(request.url, "http://plex.test/status/sessions");
  assert.equal(request.init.headers["X-Plex-Token"], "secret");
  assert.equal(presence.state, "paused");
  assert.equal(presence.kind, "movie");
  assert.equal(presence.title, "Arrival");
  assert.equal(presence.subtitle, "2016");
  assert.deepEqual(presence.artwork, {
    provider: "plex",
    itemId: null,
    imageId: "/library/metadata/1/thumb",
    imageTag: null,
    type: "thumb",
  });
  assert.equal(presence.artworkUrl, null);
});

test("returns idle when no matching session exists", async () => {
  const provider = createPlexProvider({
    baseUrl: "http://plex.test",
    token: "secret",
    fetchImpl: async () => ({ ok: true, async json() { return { MediaContainer: { Metadata: [] } }; } }),
  });
  const presence = await provider.getPresence({ username: "rowan" });
  assert.equal(presence.state, "idle");
});

test("rejects missing configuration", () => {
  assert.throws(() => createPlexProvider({ baseUrl: "http://plex.test", token: "" }), /Plex token is required/);
  assert.throws(() => createPlexProvider({ baseUrl: "", token: "secret" }), /Plex baseUrl is required/);
});

function sessionProvider(session) {
  return createPlexProvider({
    baseUrl: "http://plex.test/",
    token: "secret",
    fetchImpl: async () => ({ ok: true, async json() { return { MediaContainer: { Metadata: [session] } }; } }),
  });
}

test("maps episode series, season, episode and year", async () => {
  const presence = await sessionProvider({
    title: "The Constant", type: "episode", grandparentTitle: "Lost", parentTitle: "Season 4",
    parentIndex: 4, index: "5", year: 2008, viewOffset: 1, duration: 2,
  }).getPresence();
  assert.equal(presence.series, "Lost");
  assert.equal(presence.season, 4);
  assert.equal(presence.episode, 5);
  assert.equal(presence.year, 2008);
});

test("maps movie year and leaves episode fields empty", async () => {
  const presence = await sessionProvider({ title: "Arrival", type: "movie", year: "2016", viewOffset: 1, duration: 2 }).getPresence();
  assert.equal(presence.year, 2016);
  assert.equal(presence.series, null);
  assert.equal(presence.season, null);
  assert.equal(presence.episode, null);
});

test("drops odd episode numbers and years instead of failing", async () => {
  const presence = await sessionProvider({
    title: "Special", type: "episode", grandparentTitle: "  ", parentIndex: -1, index: 1.5, year: 42, viewOffset: 1, duration: 2,
  }).getPresence();
  assert.equal(presence.series, null);
  assert.equal(presence.season, null);
  assert.equal(presence.episode, null);
  assert.equal(presence.year, null);
});

test("tracks carry no episode or year fields", async () => {
  const presence = await sessionProvider({ title: "Song", type: "track", grandparentTitle: "Artist", parentIndex: 1, index: 3, year: 2001, viewOffset: 1, duration: 2 }).getPresence();
  assert.equal(presence.series, null);
  assert.equal(presence.season, null);
  assert.equal(presence.episode, null);
  assert.equal(presence.year, null);
});
