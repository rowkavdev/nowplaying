import test from "node:test";
import assert from "node:assert/strict";
import { createPresence } from "../src/presence.js";

test("normalizes a playing track", () => {
  const presence = createPresence({
    state: "playing",
    kind: "track",
    title: "  Song  ",
    subtitle: "Artist",
    positionMs: 1_000,
    durationMs: 4_000,
    updatedAt: "2026-09-20T20:00:00Z",
  });

  assert.deepEqual(presence, {
    state: "playing",
    kind: "track",
    title: "Song",
    subtitle: "Artist",
    artworkUrl: null,
    positionMs: 1_000,
    durationMs: 4_000,
    updatedAt: "2026-09-20T20:00:00.000Z",
  });
  assert.equal(Object.isFrozen(presence), true);
});

test("defaults to an idle unknown presence", () => {
  const presence = createPresence({ updatedAt: 0 });
  assert.equal(presence.state, "idle");
  assert.equal(presence.kind, "unknown");
  assert.equal(presence.title, null);
});

test("rejects unsupported values", () => {
  assert.throws(() => createPresence({ state: "buffering" }), /Unsupported playback state/);
  assert.throws(() => createPresence({ kind: "book" }), /Unsupported media kind/);
  assert.throws(
    () => createPresence({ positionMs: 2, durationMs: 1 }),
    /cannot exceed/,
  );
});
