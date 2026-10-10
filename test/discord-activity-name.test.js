import test from "node:test";
import assert from "node:assert/strict";
import { createPresence } from "../src/presence.js";
import { formatDiscordActivity, validateDiscordSettings, discordDefaults } from "../src/discord.js";
import { toRpcActivity } from "../src/discord-rpc.js";
import { toIpcActivity } from "../src/discord-ipc.js";

const song = (extra = {}) => createPresence({ state: "playing", kind: "track", title: "Mr. Chow", subtitle: "fakemink", artist: "fakemink", provider: "spotify", positionMs: 1000, durationMs: 5000, updatedAt: "2026-10-02T12:00:00Z", ...extra });

test("a track defaults to the name \"{title} - {artist}\"", () => {
  assert.equal(formatDiscordActivity(song()).name, "Mr. Chow - fakemink");
  assert.equal(formatDiscordActivity(song({ provider: "navidrome" })).name, "Mr. Chow - fakemink");
});

test("the default name handles missing metadata without dangling separators", () => {
  assert.equal(formatDiscordActivity(song({ provider: null })).name, "Mr. Chow - fakemink");
  assert.equal(formatDiscordActivity(song({ title: null })).name, "fakemink");
  assert.equal("name" in formatDiscordActivity(song({ title: null, artist: null, subtitle: null })), false);
  assert.equal(formatDiscordActivity(song({ artist: null, subtitle: "Album Only" })).name, "Mr. Chow");
});

test("films and episodes keep Discord's app name unless a name template is set", () => {
  const movie = createPresence({ state: "playing", kind: "movie", title: "Arrival", provider: "plex", updatedAt: "2026-10-02T12:00:00Z" });
  assert.equal("name" in formatDiscordActivity(movie), false);
  assert.equal(formatDiscordActivity(movie, { name: "{title} on {service}" }).name, "Arrival on Plex");
});

test("a custom name template, {{ }} escapes and statusDisplayType are applied", () => {
  const activity = formatDiscordActivity(song(), { name: "{{live}} {artist}", statusDisplayType: "details" });
  assert.equal(activity.name, "{live} fakemink");
  assert.equal(activity.statusDisplayType, "details");
  assert.equal("statusDisplayType" in formatDiscordActivity(song()), false);
  assert.equal("name" in formatDiscordActivity(song(), { name: "{album}" }), false);
});

test("name and statusDisplayType are validated", () => {
  assert.throws(() => validateDiscordSettings({ name: "{nope}" }), /unknown field/);
  assert.throws(() => validateDiscordSettings({ name: "x".repeat(129) }), /up to 128/);
  assert.throws(() => validateDiscordSettings({ statusDisplayType: "title" }), /name, state or details/);
  assert.equal(discordDefaults.name, "{title} - {artist}");
});

test("name and status_display_type reach Discord's wire payload", () => {
  const rpc = toRpcActivity(formatDiscordActivity(song(), { statusDisplayType: "state" }));
  assert.equal(rpc.name, "Mr. Chow - fakemink");
  assert.equal(rpc.statusDisplayType, "state");
  const wire = toIpcActivity(rpc);
  assert.equal(wire.name, "Mr. Chow - fakemink");
  assert.equal(wire.status_display_type, 1);
  assert.equal(wire.type, 2);
  const plain = toIpcActivity(toRpcActivity(formatDiscordActivity(song())));
  assert.equal(plain.name, "Mr. Chow - fakemink");
  assert.equal("status_display_type" in plain, false);
  assert.throws(() => toIpcActivity({ statusDisplayType: "bogus" }), /statusDisplayType is not supported/);
});

test("statusDisplayType is sent even when the custom name is empty", () => {
  const noArtist = formatDiscordActivity(song({ title: null, artist: null, subtitle: null }), { statusDisplayType: "state" });
  assert.equal("name" in noArtist, false);
  assert.equal(noArtist.statusDisplayType, "state");
  assert.equal(formatDiscordActivity(song(), { name: "", statusDisplayType: "details" }).statusDisplayType, "details");
});

test("the {mediaType} token renders the normalized kind in the Discord name (#1119)", () => {
  for (const kind of ["track", "movie", "episode", "show", "unknown"]) {
    const presence = createPresence({ state: "playing", kind, title: "T", provider: "plex", updatedAt: "2026-10-02T12:00:00Z" });
    assert.equal(formatDiscordActivity(presence, { name: "{mediaType}" }).name, kind);
  }
});

test("saved custom naming templates keep their wording", () => {
  assert.equal(formatDiscordActivity(song(), { name: "{artist} on {service}" }).name, "fakemink on Spotify");
});
