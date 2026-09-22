import test from "node:test";
import assert from "node:assert/strict";
import { createPresence } from "../src/presence.js";
import { expireStalePresence } from "../src/presence-policy.js";

const now = Date.parse("2026-09-22T05:00:00.000Z");

test("preserves a fresh presence unchanged", () => {
  const presence = createPresence({ state: "playing", kind: "track", title: "Private title", updatedAt: new Date(now - 30_000) });
  assert.equal(expireStalePresence(presence, { now }), presence);
});

test("expires stale media to a privacy-safe offline presence", () => {
  const presence = createPresence({
    state: "playing",
    kind: "track",
    title: "Private title",
    subtitle: "Private artist",
    artworkUrl: "https://media.example/private.jpg",
    positionMs: 10_000,
    durationMs: 100_000,
    updatedAt: new Date(now - 60_001),
  });
  assert.deepEqual(expireStalePresence(presence, { now }), createPresence({
    state: "offline",
    kind: "track",
    updatedAt: new Date(now),
  }));
});

test("supports a caller-selected freshness timeout", () => {
  const presence = createPresence({ state: "paused", kind: "episode", updatedAt: new Date(now - 2_000) });
  assert.equal(expireStalePresence(presence, { now, staleAfterMs: 1_000 }).state, "offline");
});
