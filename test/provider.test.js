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
