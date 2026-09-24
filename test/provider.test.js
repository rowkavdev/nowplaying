import test from "node:test";
import assert from "node:assert/strict";
import { defineProvider } from "../src/provider.js";

test("normalizes adapter output", async () => {
  const provider = defineProvider({
    id: "jellyfin",
    getPresence: async ({ userId }) => ({
      state: "playing",
      kind: "movie",
      title: userId,
      updatedAt: 0,
    }),
  });

  const presence = await provider.getPresence({ userId: "Arrival" });
  assert.equal(provider.id, "jellyfin");
  assert.equal(presence.title, "Arrival");
  assert.equal(presence.subtitle, null);
});

test("rejects invalid provider definitions", () => {
  assert.throws(() => defineProvider({ id: "Jellyfin", getPresence() {} }), /lowercase slug/);
  assert.throws(() => defineProvider({ id: "plex" }), /must be a function/);
});

test("rejects invalid adapter output", async () => {
  const provider = defineProvider({
    id: "plex",
    getPresence: async () => ({ state: "buffering" }),
  });
  await assert.rejects(provider.getPresence(), /Unsupported playback state/);
});

test("providers declare which media kinds they can report (#143)", async () => {
  const all = defineProvider({ id: "plex", getPresence: async () => ({ state: "playing", kind: "movie", title: "Arrival" }) });
  assert.deepEqual([...all.mediaKinds], ["track", "episode", "movie"]);
  assert.equal(Object.isFrozen(all.mediaKinds), true);
  assert.equal((await all.getPresence()).kind, "movie");
  // Order and duplicates don't matter.
  assert.deepEqual([...defineProvider({ id: "x", getPresence: async () => ({}), mediaKinds: ["movie", "track", "movie"] }).mediaKinds], ["track", "movie"]);
});

test("a kind the provider doesn't claim comes through as unknown", async () => {
  let next = { state: "playing", kind: "episode", title: "Pilot", series: "Show", season: 1, episode: 1 };
  const music = defineProvider({ id: "navidrome", mediaKinds: ["track"], getPresence: async () => next });
  const p = await music.getPresence();
  assert.equal(p.kind, "unknown");
  assert.equal(p.title, "Pilot");
  assert.equal(p.series, null);
  assert.equal(p.episode, null);
  next = { state: "playing", kind: "track", title: "Song" };
  assert.equal((await music.getPresence()).kind, "track");
  next = { state: "idle" };
  assert.equal((await music.getPresence()).state, "idle");
  const tv = defineProvider({ id: "tv", mediaKinds: ["episode"], getPresence: async () => ({ state: "playing", kind: "show", title: "Show" }) });
  assert.equal((await tv.getPresence()).kind, "show");
});

test("rejects bad media kind lists", () => {
  for (const mediaKinds of [[], ["podcast"], "track", [null]]) {
    assert.throws(() => defineProvider({ id: "plex", getPresence() {}, mediaKinds }), /mediaKinds/);
  }
});
