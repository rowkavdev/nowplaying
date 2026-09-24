
import test from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_ARTWORK_URL } from "../src/discord-artwork.js";

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
    largeImage: FALLBACK_ARTWORK_URL,
    largeText: "Playing · 33%",
    startTimestamp: 1_789_905_600,
    endTimestamp: 1_789_905_690,
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
      largeImage: FALLBACK_ARTWORK_URL,
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
    type: "listening",
    details: "Nothing playing",
    largeImage: FALLBACK_ARTWORK_URL,
    largeText: "Idle",
  });
});

test("validates fields and Discord asset keys", () => {
  assert.throws(
    () => validateDiscordSettings({ details: "{serverToken}" }),
    { message: "discord.details: unknown field {serverToken}" },
  );
  assert.doesNotThrow(() => validateDiscordSettings({ largeImage: "https://example.test/image.png" }));
  assert.doesNotThrow(() => validateDiscordSettings({ largeImage: "media" }));
  for (const bad of ["http://example.test/image.png", "https://192.168.1.20/image.png", "https://example.test/i.png?api_key=x", "bad key"]) {
    assert.throws(() => validateDiscordSettings({ largeImage: bad }), { message: "discord.largeImage: expected an asset key or a public HTTPS image URL" });
  }
  assert.deepEqual(formatDiscordActivity(playing, { buttons: [{ label: "Open Plex", url: "https://app.plex.tv" }] }).buttons, [{ label: "Open Plex", url: "https://app.plex.tv" }]);
  assert.throws(() => validateDiscordSettings({ buttons: [{ label: "Bad", url: "http://private.test" }] }), /valid HTTPS URL/);
  assert.throws(() => validateDiscordSettings({ buttons: [{ label: "One", url: "https://example.test/1" }, { label: "Two", url: "https://example.test/2" }, { label: "Three", url: "https://example.test/3" }] }), /up to two buttons/);
  assert.doesNotThrow(() => validateDiscordSettings({ minUpdateIntervalMs: 5000 }));
  assert.throws(() => validateDiscordSettings({ minUpdateIntervalMs: 4999 }), /5000 to 300000/);
});

test("truncates without splitting Unicode code points", () => {
  const activity = formatDiscordActivity({ ...playing, title: "😀".repeat(140) });
  assert.equal([...activity.details].length, 128);
  assert.equal(activity.details.endsWith("😀"), true);
});

test("defaults to Listening with a progress bar and no bar while paused", () => {
  const activity = formatDiscordActivity({ ...playing, kind: "track" });
  assert.equal(activity.type, "listening");
  assert.equal(activity.startTimestamp, 1_789_905_600);
  assert.equal(activity.endTimestamp, 1_789_905_690);
  const paused = formatDiscordActivity({ ...playing, state: "paused" });
  assert.equal(paused.startTimestamp, undefined);
  assert.equal(paused.endTimestamp, undefined);
});

test("films and TV show as Watching, music and unknown media as Listening", () => {
  const base = { state: "playing", title: "Pilot", subtitle: "Show", positionMs: 0, durationMs: 1000, updatedAt: new Date(0) };
  for (const kind of ["episode", "movie", "show"]) assert.equal(formatDiscordActivity({ ...base, kind }).type, "watching");
  for (const kind of ["track", "unknown", undefined]) assert.equal(formatDiscordActivity({ ...base, kind }).type, "listening");
});

const episode = { ...playing, title: "The Constant", subtitle: "Lost", series: "Lost", season: 4, episode: 5 };

test("episodes default to series, then episode code and title", () => {
  const activity = formatDiscordActivity(episode);
  assert.equal(activity.details, "Lost");
  assert.equal(activity.state, "S04E05 · The Constant");
  const saved = formatDiscordActivity(episode, { details: "{title}", state: "{subtitle}" });
  assert.equal(saved.details, "Lost");
  assert.equal(saved.state, "S04E05 · The Constant");
});

test("episode defaults drop a missing episode code", () => {
  assert.equal(formatDiscordActivity({ ...episode, season: null, episode: null }).state, "The Constant");
});

test("custom templates win over episode defaults, field by field", () => {
  const activity = formatDiscordActivity(episode, { details: "{title} ({series})" });
  assert.equal(activity.details, "The Constant (Lost)");
  assert.equal(activity.state, "S04E05 · The Constant");
  assert.equal(formatDiscordActivity(episode, { state: "{stateLabel}" }).state, "Playing");
});

test("episodes without a series name and other kinds keep the plain defaults", () => {
  const bare = formatDiscordActivity({ ...episode, series: null });
  assert.equal(bare.details, "The Constant");
  assert.equal(bare.state, "Lost");
  const movie = formatDiscordActivity({ ...playing, kind: "movie", title: "Arrival", subtitle: "2016", year: 2016 });
  assert.equal(movie.details, "Arrival");
  assert.equal(movie.state, "2016");
});
