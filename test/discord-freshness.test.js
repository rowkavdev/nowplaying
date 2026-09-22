import test from "node:test";
import assert from "node:assert/strict";
import { createPresence } from "../src/presence.js";
import { formatFreshDiscordActivity } from "../src/discord-freshness.js";

const now = Date.parse("2026-09-22T05:00:00.000Z");

test("clears stale Discord activity by default", () => {
  const presence = createPresence({ state: "playing", kind: "track", title: "Old title", updatedAt: new Date(now - 60_001) });
  assert.equal(formatFreshDiscordActivity(presence, {}, { now }), null);
});

test("shows only a privacy-safe offline Discord activity when opted in", () => {
  const presence = createPresence({ state: "playing", kind: "episode", title: "Old episode", subtitle: "Old show", updatedAt: new Date(now - 60_001) });
  const activity = formatFreshDiscordActivity(presence, { idleBehavior: "show" }, { now });
  assert.equal(activity.largeText, "Offline");
  assert.equal(activity.details, undefined);
  assert.equal(activity.state, undefined);
  assert.equal(JSON.stringify(activity).includes("Old"), false);
});

test("formats fresh Discord activity normally", () => {
  const presence = createPresence({ state: "playing", kind: "track", title: "Current title", updatedAt: new Date(now - 1_000) });
  assert.equal(formatFreshDiscordActivity(presence, {}, { now }).details, "Current title");
});
