import test from "node:test";
import assert from "node:assert/strict";

import { formatDiscordActivity, validateDiscordSettings } from "../src/discord.js";

const playing = {
  state: "playing",
  kind: "episode",
  title: "Episode",
  subtitle: "Example Show",
  positionMs: 30_000,
  durationMs: 90_000,
  updatedAt: "2026-09-20T12:00:30.000Z",
};

test("formats activity from shared templates", () => {
  const activity = formatDiscordActivity(playing, {
    details: "{title}",
    state: "Watching {subtitle}",
    largeText: "{stateLabel} · {progressPercent}%",
  });
  assert.deepEqual(activity, {
    type: "watching",
    details: "Episode",
    state: "Watching Example Show",
    largeImage: "media",
    largeText: "Playing · 33%",
    startTimestamp: 1_789_905_600,
  });
  assert.equal(Object.isFrozen(activity), true);
});

test("supports elapsed, remaining, both and no timestamps", () => {
  assert.equal(
    formatDiscordActivity(playing, { timestamps: "remaining" }).endTimestamp,
    1_789_905_690,
  );
  assert.deepEqual(
    formatDiscordActivity(playing, { timestamps: "both" }),
    {
      type: "watching",
      details: "Episode",
      state: "Example Show",
      largeImage: "media",
      largeText: "Playing",
      startTimestamp: 1_789_905_600,
      endTimestamp: 1_789_905_690,
    },
  );
  assert.equal("startTimestamp" in formatDiscordActivity(playing, { timestamps: "none" }), false);
});

test("does not advance timestamps while paused", () => {
  const activity = formatDiscordActivity({ ...playing, state: "paused" });
  assert.equal("startTimestamp" in activity, false);
  assert.equal("endTimestamp" in activity, false);
});

test("clears idle by default or shows an explicit idle activity", () => {
  const idle = { state: "idle", kind: "unknown", title: null, subtitle: null, updatedAt: playing.updatedAt };
  assert.equal(formatDiscordActivity(idle), null);
  assert.deepEqual(formatDiscordActivity(idle, { idleBehavior: "show" }), {
    type: "watching",
    details: "Nothing playing",
    largeImage: "media",
    largeText: "Idle",
  });
});

test("validates fields and Discord asset keys", () => {
  assert.throws(
    () => validateDiscordSettings({ details: "{serverToken}" }),
    { message: "discord.details: unknown field {serverToken}" },
  );
  assert.throws(
    () => validateDiscordSettings({ largeImage: "https://example.test/image.png" }),
    { message: "discord.largeImage: expected an asset key" },
  );
  assert.throws(
    () => validateDiscordSettings({ buttons: [] }),
    { message: "discord.buttons: unknown setting" },
  );
});

test("truncates without splitting Unicode code points", () => {
  const activity = formatDiscordActivity({ ...playing, title: "😀".repeat(140) });
  assert.equal([...activity.details].length, 128);
  assert.equal(activity.details.endsWith("😀"), true);
});
