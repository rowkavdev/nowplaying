import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyCardChanges, applyDiscordChanges, applyHostedChanges, applyHostedDestinationChanges,
  applyPrivacyChanges, applyServerRemoval, applySpotifyChanges, createAppSettingsStore, privacySettingsView,
} from "../src/app-settings.js";
import { parseAppConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";

// Settings saves take whatever the local UI (or anything holding the session
// cookie) posts. Every value is re-validated against the setup rules before
// config.json is rewritten; these tests fuzz the edges of that contract.

const BASE = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true };
const config = () => parseAppConfig(serializeSetupConfig(BASE));

const JUNK = [null, undefined, [], "enabled", 42, true];

test("every settings section rejects non-object and empty changes", () => {
  const cfg = config();
  for (const junk of JUNK) {
    assert.throws(() => applyDiscordChanges(cfg, junk), TypeError, `discord ${String(junk)}`);
    assert.throws(() => applyHostedChanges(cfg, junk), TypeError, `hosted ${String(junk)}`);
    assert.throws(() => applyPrivacyChanges(cfg, junk), TypeError, `privacy ${String(junk)}`);
    assert.throws(() => applyCardChanges(cfg, junk), TypeError, `card ${String(junk)}`);
  }
  assert.throws(() => applyDiscordChanges(cfg, {}), TypeError);
  assert.throws(() => applyPrivacyChanges(cfg, {}), TypeError);
});

test("prototype-pollution shaped payloads are rejected and never pollute", () => {
  const cfg = config();
  const poisoned = JSON.parse('{"__proto__": { "enabled": true }, "enabled": false}');
  assert.throws(() => applyDiscordChanges(cfg, poisoned), TypeError);
  assert.throws(() => applyPrivacyChanges(cfg, JSON.parse('{"__proto__": { "hideTitles": true }}')), TypeError);
  assert.equal({}.enabled, undefined);
  assert.equal({}.hideTitles, undefined);
  // Constructor/prototype walks are just unknown settings.
  assert.throws(() => applyDiscordChanges(cfg, JSON.parse('{"constructor": { "prototype": { "enabled": true } }}')), TypeError);
});

test("discord values are validated through the setup rules, not just their keys", () => {
  const cfg = config();
  for (const enabled of [1, 0, null, "yes", [], {}]) assert.throws(() => applyDiscordChanges(cfg, { enabled }), TypeError, String(enabled));
  for (const timestamps of ["forever", 1, null, []]) assert.throws(() => applyDiscordChanges(cfg, { timestamps }), TypeError, String(timestamps));
  for (const artworkLookup of ["itunes", 1, null, []]) assert.throws(() => applyDiscordChanges(cfg, { artworkLookup }), TypeError, String(artworkLookup));
  for (const idleBehavior of ["forever", 1, null, [], "CLEAR"]) assert.throws(() => applyDiscordChanges(cfg, { idleBehavior }), TypeError, String(idleBehavior));
});

test("privacy values must be real booleans; kinds land in order", () => {
  const cfg = config();
  for (const key of ["hideTitles", "hideArtwork", "hideProgress", "hideMovies", "hideEpisodes", "hideMusic"]) {
    for (const value of [1, 0, "true", null, [], {}]) {
      assert.throws(() => applyPrivacyChanges(cfg, { [key]: value }), TypeError, `${key}=${String(value)}`);
    }
  }
  const { config: saved } = applyPrivacyChanges(cfg, { hideMusic: true, hideMovies: true });
  assert.deepEqual(saved.privacy.suppressMediaKinds, ["movie", "track"]);
  assert.deepEqual({ ...privacySettingsView(saved) }, { hideTitles: false, hideArtwork: false, hideProgress: false, hideMovies: true, hideEpisodes: false, hideMusic: true });
});

test("card numbers stay inside their ranges and integers only", () => {
  const cfg = config();
  for (const width of [0, -1, 279, 801, 1.5, NaN, "440", null, []]) {
    assert.throws(() => applyCardChanges(cfg, { width }), TypeError, String(width));
  }
  for (const radius of [-1, 25, 0.5]) assert.throws(() => applyCardChanges(cfg, { radius }), TypeError, String(radius));
  assert.equal(applyCardChanges(cfg, { radius: 0 }).config.card.radius, 0, "radius allows zero");
  assert.equal(applyCardChanges(cfg, { width: 280 }).config.card.width, 280);
  assert.equal(applyCardChanges(cfg, { width: 800 }).config.card.width, 800);
});

test("card choices reject lookalikes; fieldOrder must list each field once", () => {
  const cfg = config();
  for (const theme of ["dark", "Midnight-Blue", "", 1, null]) assert.throws(() => applyCardChanges(cfg, { theme }), TypeError, String(theme));
  for (const direction of ["up", "RTL", 1, null]) assert.throws(() => applyCardChanges(cfg, { direction }), TypeError, String(direction));
  for (const fieldOrder of [["state", "state", "title"], ["state", "title"], "state,title,subtitle", ["state", "title", "bogus"], [1, 2, 3]]) {
    assert.throws(() => applyCardChanges(cfg, { fieldOrder }), TypeError, String(fieldOrder));
  }
  for (const artworkTint of ["yes", 1, null]) assert.throws(() => applyCardChanges(cfg, { artworkTint }), TypeError, String(artworkTint));
  assert.throws(() => applyCardChanges(cfg, { font: "comic-sans" }), TypeError);
});

test("spotify changes demand a real client id and identity, null disconnects", () => {
  const cfg = config();
  for (const bad of [{ clientId: "abc", identity: { id: "s" } }, { clientId: "z".repeat(32), identity: { id: "s" } }, { clientId: "a".repeat(32) }, "x", 42]) {
    assert.throws(() => applySpotifyChanges(cfg, bad), TypeError, JSON.stringify(bad));
  }
  const account = { clientId: "a".repeat(32), identity: { id: "s1", displayName: "Rowan" } };
  assert.equal(applySpotifyChanges(cfg, account).config.spotify.identity.id, "s1");
  assert.equal(applySpotifyChanges(applySpotifyChanges(cfg, account).config, null).config.spotify, undefined);
});

test("hosted destination only takes https URLs with no credentials, query or fragment", () => {
  const cfg = config();
  assert.throws(() => applyHostedDestinationChanges(cfg, {}), TypeError);
  assert.throws(() => applyHostedDestinationChanges(cfg, { enabled: false }), TypeError);
  for (const url of ["javascript:alert(1)", "ftp://x/y", "https://user:pass@x.example", "https://x.example/cards?a=1", "https://x.example/cards#f", "not a url", 42]) {
    assert.throws(() => applyHostedDestinationChanges(cfg, { enabled: true, url }), TypeError, String(url));
  }
  const { config: saved } = applyHostedDestinationChanges(cfg, { enabled: true, url: "https://cards.example.com/" });
  assert.equal(saved.hosted.url, "https://cards.example.com", "trailing slash is normalized away");
});

test("server removal refuses unknown servers, the last server and junk selectors", () => {
  const cfg = config();
  assert.throws(() => applyServerRemoval(cfg, { provider: "plex", id: "u1" }), TypeError);
  assert.throws(() => applyServerRemoval(cfg, { provider: "jellyfin", id: "nobody" }), TypeError);
  assert.throws(() => applyServerRemoval(cfg, { provider: "jellyfin", id: "u1" }), /keep at least one server/);
  assert.throws(() => applyServerRemoval(cfg, {}), TypeError);
  assert.throws(() => applyServerRemoval(cfg), TypeError);
});

test("the store serializes concurrent saves, survives a rejected one, and never loses a section", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-fuzz-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig({ ...BASE, hostedEnabled: true }));
  const store = createAppSettingsStore({ file });
  const [privacy, card] = await Promise.all([
    store.updatePrivacy({ hideTitles: true }),
    store.updateCard({ width: 300 }),
  ]);
  assert.equal(privacy.privacy.redactTitles, true);
  assert.equal(card.card.width, 300);
  const final = parseAppConfig(await readFile(file, "utf8"));
  assert.equal(final.privacy.redactTitles, true, "both saves landed");
  assert.equal(final.card.width, 300);
  assert.equal(final.hosted.enabled, true, "untouched sections survive");
  await assert.rejects(store.updatePrivacy({ hideTitles: "yes" }), TypeError);
  const after = await store.updatePrivacy({ hideArtwork: true });
  assert.equal(after.privacy.hideArtwork, true, "the queue keeps working after a rejection");
  assert.equal(after.privacy.redactTitles, true, "the failed save changed nothing");
});
