import test from "node:test";
import assert from "node:assert/strict";
import { createPresence } from "../src/presence.js";
import { formatDiscordActivity, validateDiscordSettings, discordDefaults } from "../src/discord.js";
import { toRpcActivity } from "../src/discord-rpc.js";
import { toIpcActivity } from "../src/discord-ipc.js";

const song = (extra = {}) => createPresence({ state: "playing", kind: "track", title: "Mr. Chow", subtitle: "fakemink", artist: "fakemink", provider: "spotify", positionMs: 1000, durationMs: 5000, updatedAt: "2026-10-02T12:00:00Z", ...extra });

test("a track defaults to the name \"{artist} on {service}\"", () => {
  assert.equal(formatDiscordActivity(song()).name, "fakemink on Spotify");
  assert.equal(formatDiscordActivity(song({ provider: "navidrome" })).name, "fakemink on Navidrome");
});

test("the default name is just the artist when the source is unknown, and absent without an artist", () => {
  assert.equal(formatDiscordActivity(song({ provider: null })).name, "fakemink");
  assert.equal("name" in formatDiscordActivity(song({ artist: null, subtitle: "Album Only" })), false);
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
  assert.equal(discordDefaults.name, "{artist} on {service}");
});

test("name and status_display_type reach Discord's wire payload", () => {
  const rpc = toRpcActivity(formatDiscordActivity(song(), { statusDisplayType: "state" }));
  assert.equal(rpc.name, "fakemink on Spotify");
  assert.equal(rpc.statusDisplayType, "state");
  const wire = toIpcActivity(rpc);
  assert.equal(wire.name, "fakemink on Spotify");
  assert.equal(wire.status_display_type, 1);
  assert.equal(wire.type, 2);
  const plain = toIpcActivity(toRpcActivity(formatDiscordActivity(song())));
  assert.equal(plain.name, "fakemink on Spotify");
  assert.equal("status_display_type" in plain, false);
  assert.throws(() => toIpcActivity({ statusDisplayType: "bogus" }), /statusDisplayType is not supported/);
});

test("statusDisplayType is sent even when there is no name (no artist, or an empty custom name)", () => {
  const noArtist = formatDiscordActivity(song({ artist: null, subtitle: "Album Only" }), { statusDisplayType: "state" });
  assert.equal("name" in noArtist, false);
  assert.equal(noArtist.statusDisplayType, "state");
  assert.equal(formatDiscordActivity(song(), { name: "", statusDisplayType: "details" }).statusDisplayType, "details");
});
