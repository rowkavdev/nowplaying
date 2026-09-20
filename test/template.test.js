import test from "node:test";
import assert from "node:assert/strict";

import {
  createTemplateValues,
  formatTemplate,
  templateFields,
  validateTemplate,
} from "../src/template.js";

test("creates portable values with bounded progress and durations", () => {
  const values = createTemplateValues({
    title: "Episode",
    subtitle: "Example Show",
    album: null,
    year: 2026,
    provider: "jellyfin",
    mediaType: "episode",
    state: "paused",
    positionMs: 3_661_900,
    durationMs: 3_600_000,
  });

  assert.equal(values.stateLabel, "Paused");
  assert.equal(values.position, "1:01:01");
  assert.equal(values.duration, "1:00:00");
  assert.equal(values.progressPercent, "100");
  assert.equal(values.album, "");
  assert.equal(Object.isFrozen(values), true);
});

test("supports custom state labels", () => {
  const values = createTemplateValues(
    { state: "playing", title: "Track" },
    { labels: { playing: "Listening" } },
  );
  assert.equal(values.stateLabel, "Listening");
});

test("formats documented fields", () => {
  const values = createTemplateValues({
    title: "Song",
    subtitle: "Artist",
    album: "Album",
    state: "playing",
    positionMs: 62_000,
    durationMs: 185_000,
  });
  assert.equal(
    formatTemplate("{title} · {subtitle} · {position}/{duration}", values),
    "Song · Artist · 1:02/3:05",
  );
});

test("removes empty separator segments", () => {
  assert.equal(
    formatTemplate("{title} · {subtitle} · {year}", { title: "Movie", subtitle: "", year: "" }),
    "Movie",
  );
  assert.equal(
    formatTemplate("{title} · {subtitle}", { title: "", subtitle: "Artist" }),
    "Artist",
  );
});

test("keeps surrounding text when a segment has another value", () => {
  assert.equal(
    formatTemplate("{title} · by {subtitle}", { title: "Song", subtitle: "Artist" }),
    "Song · by Artist",
  );
  assert.equal(
    formatTemplate("{title} · by {subtitle}", { title: "Song", subtitle: "" }),
    "Song",
  );
});

test("rejects unknown fields", () => {
  assert.throws(
    () => validateTemplate("{title} by {artist}", "discord.details"),
    { message: "discord.details: unknown field {artist}" },
  );
});

test("exports every supported template field", () => {
  assert.deepEqual(templateFields, [
    "title",
    "subtitle",
    "album",
    "year",
    "provider",
    "mediaType",
    "state",
    "stateLabel",
    "position",
    "duration",
    "progressPercent",
  ]);
});
