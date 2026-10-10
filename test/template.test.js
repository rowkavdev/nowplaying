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
    () => validateTemplate("{title} by {singer}", "discord.details"),
    { message: "discord.details: unknown field {singer}" },
  );
});

test("exports every supported template field", () => {
  assert.deepEqual(templateFields, [
    "title",
    "subtitle",
    "artist",
    "service",
    "album",
    "year",
    "series",
    "season",
    "episode",
    "episodeCode",
    "provider",
    "mediaType",
    "state",
    "stateLabel",
    "position",
    "duration",
    "progressPercent",
  ]);
});

test("formats series, season, episode and a compact episode code", () => {
  const values = createTemplateValues({ state: "playing", title: "Pilot", series: "The Show", season: 2, episode: 5, year: 2024 });
  assert.deepEqual([values.series, values.season, values.episode, values.episodeCode, values.year], ["The Show", "2", "5", "S02E05", "2024"]);
  assert.equal(createTemplateValues({ episode: 7 }).episodeCode, "E07");
  assert.equal(createTemplateValues({ season: 1 }).episodeCode, "S01");
  assert.deepEqual([createTemplateValues({}).episodeCode, createTemplateValues({}).series, createTemplateValues({}).season], ["", "", ""]);
});

test("{artist} and {service} come from the track artist and the source's display name", () => {
  const values = createTemplateValues({ state: "playing", title: "Mr. Chow", subtitle: "fakemink", artist: "fakemink", provider: "navidrome" });
  assert.equal(formatTemplate("{artist} on {service}", values), "fakemink on Navidrome");
  assert.equal(createTemplateValues({ state: "playing", provider: "spotify" }).service, "Spotify");
  assert.equal(createTemplateValues({ state: "playing", provider: "tidal" }).service, "Tidal");
  assert.equal(createTemplateValues({ state: "playing" }).service, "");
  assert.equal(createTemplateValues({ state: "playing", subtitle: "Album Name" }).artist, "");
});

test("{{ and }} write literal braces and are not read as fields", () => {
  const values = { title: "Song", artist: "Band" };
  assert.equal(formatTemplate("{{title}} = {title}", values), "{title} = Song");
  assert.equal(formatTemplate("{{{artist}}}", values), "{Band}");
  assert.doesNotThrow(() => validateTemplate("{{not a field}}"));
  assert.throws(() => validateTemplate("{{ok}} {nope}"), /unknown field \{nope\}/);
  assert.equal(formatTemplate("{title}", { title: "a{{b}}c" }), "a{{b}}c");
});

test("{service} for a provider id that names an Object.prototype property is plain text", () => {
  for (const id of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
    const service = createTemplateValues({ state: "playing", provider: id }).service;
    assert.equal(service, id.charAt(0).toUpperCase() + id.slice(1));
  }
});

test("mediaType comes from the normalized presence kind, raw field as fallback (#1119)", () => {
  assert.equal(createTemplateValues({ kind: "track", state: "playing" }).mediaType, "track");
  assert.equal(createTemplateValues({ kind: "movie", state: "playing" }).mediaType, "movie");
  assert.equal(createTemplateValues({ mediaType: "episode", state: "paused" }).mediaType, "episode");
});
