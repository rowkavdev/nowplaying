import test from "node:test";
import assert from "node:assert/strict";
import { createPresence } from "../src/presence.js";
import { formatFreshDiscordActivity } from "../src/discord-freshness.js";

const now = Date.parse("2026-09-22T05:00:00.000Z");

test("clears stale Discord activity by default", () => {
  const presence = createPresence({ state: "playing", kind: "track", title: "Old title", updatedAt: new Date(now - 60_001) });
  assert.equal(formatFreshDiscordActivity(presence, {}, { now }), null);
});

test("can show an explicit offline Discord activity without stale metadata", () => {
  const presence = createPresence({ state: "playing", kind: "episode", title: "Old episode", subtitle: "Old show", updatedAt: new Date(now - 60_001) });
  assert.deepEqual(formatFreshDiscordActivity(presence, { idleBehavior: "show" }, { now }), {
    type: "watching",
    largeImage: "media",
    largeText: "Offline",
  });
});

test("formats fresh Discord activity normally", () => {
  const presence = createPresence({ state: "playing", kind: "track", title: "Current title", updatedAt: new Date(now - 1_000) });
  assert.equal(formatFreshDiscordActivity(presence, {}, { now }).details, "Current title");
});
