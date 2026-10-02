import test from "node:test";
import assert from "node:assert/strict";
import { createPresence } from "../src/presence.js";
import { defineProvider } from "../src/provider.js";

test("presence keeps an artist and a provider id and defaults both to null", () => {
  assert.equal(createPresence({ state: "playing", kind: "track", title: "A", artist: " Fakemink ", provider: "spotify" }).artist, "Fakemink");
  assert.equal(createPresence({ state: "playing", kind: "track", title: "A", provider: "spotify" }).provider, "spotify");
  const bare = createPresence({ state: "playing", kind: "track", title: "A" });
  assert.equal(bare.artist, null);
  assert.equal(bare.provider, null);
});

test("presence rejects a provider that is not a lowercase slug", () => {
  assert.throws(() => createPresence({ state: "playing", kind: "track", title: "A", provider: "Spotify!" }), /lowercase slug/);
  assert.throws(() => createPresence({ state: "playing", kind: "track", title: "A", artist: 3 }), /artist must be a string/);
});

test("a provider stamps its own id on every presence and cannot be overridden by the adapter", async () => {
  const provider = defineProvider({ id: "navidrome", getPresence: async () => ({ state: "playing", kind: "track", title: "A", provider: "plex" }) });
  assert.equal((await provider.getPresence()).provider, "navidrome");
});
