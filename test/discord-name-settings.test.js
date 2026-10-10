import test from "node:test";
import assert from "node:assert/strict";
import { applyDiscordChanges, discordSettingsView } from "../src/app-settings.js";
import { parseAppConfig, startDiscordFromConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";
import { createSettingsPageHandler } from "../src/settings-page-handler.js";

const BASE = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true };
const song = { state: "playing", kind: "track", title: "Mr. Chow", subtitle: "fakemink", artist: "fakemink", provider: "spotify", positionMs: 1000, durationMs: 5000, updatedAt: "2026-10-02T12:00:00Z" };

test("the status text and which field Discord shows are saved, kept and read back", () => {
  const before = parseAppConfig(serializeSetupConfig(BASE));
  assert.equal(discordSettingsView(before).name, "");
  assert.equal(discordSettingsView(before).statusDisplayType, "name");
  const { config, text } = applyDiscordChanges(before, { name: "{artist} on {service}!", statusDisplayType: "state" });
  assert.equal(config.discord.name, "{artist} on {service}!");
  assert.equal(config.discord.statusDisplayType, "state");
  const again = applyDiscordChanges(parseAppConfig(text), { enabled: false });
  assert.equal(again.config.discord.name, "{artist} on {service}!");
  const cleared = applyDiscordChanges(config, { name: "", statusDisplayType: "name" });
  assert.equal("name" in cleared.config.discord, false);
  assert.equal("statusDisplayType" in cleared.config.discord, false);
  assert.throws(() => applyDiscordChanges(before, { statusDisplayType: "title" }), /statusDisplayType/);
  assert.throws(() => applyDiscordChanges(before, { name: "x".repeat(129) }), /name/);
});

test("a saved status text reaches the Discord wire payload", async () => {
  const sets = [];
  const transport = { connect: async () => {}, setActivity: async (a) => sets.push(a), clearActivity: async () => {}, close: async () => {} };
  const config = { discord: { enabled: true, idleBehavior: "clear", name: "{artist} @ {service}", statusDisplayType: "details" } };
  const d = startDiscordFromConfig(config, { getPresence: async () => song }, { env: { NOWPLAYING_DISCORD_CLIENT_ID: "123456789012345678" }, createTransport: () => transport, intervalMs: 60_000 });
  await d.stop();
  assert.equal(sets[0].name, "fakemink @ Spotify");
  assert.equal(sets[0].statusDisplayType, "details");
});

test("the page has the status text field with its tokens and brace help", async () => {
  const h = createSettingsPageHandler({ settings: { read: () => ({ discord: { enabled: true } }), updateDiscord: async () => {} }, fallback: async () => ({ status: 299 }) });
  const page = (await h({ url: "/settings" })).body;
  assert.match(page, /<label for="discord-name">Status text<\/label>/);
  assert.match(page, /id="discord-name"[^>]*aria-describedby="discord-name-help"/);
  assert.match(page, /id="discord-name"[^>]*placeholder="\{title\} - \{artist\}"/);
  assert.match(page, /Leave it empty for "\{title\} - \{artist\}" on music/);
  assert.match(page, /\{artist\}[^<]*\{service\}/);
  assert.match(page, /\{\{ or \}\}/);
  assert.match(page, /<option value="state">/);
  const script = (await h({ url: "/settings.js" })).body;
  assert.match(script, /name: fields\.name\.value\.trim\(\)/);
});

test("an unknown {field} is rejected before anything is written, and the message reaches the page", async () => {
  const before = parseAppConfig(serializeSetupConfig(BASE));
  assert.throws(() => applyDiscordChanges(before, { name: "{bogus} on {service}" }), /unknown field \{bogus\}/);
  assert.throws(() => serializeSetupConfig({ ...BASE, discordName: "{bogus}" }), /unknown field \{bogus\}/);
  const h = createSettingsPageHandler({ settings: { read: () => ({ discord: { enabled: true } }), updateDiscord: async (changes) => applyDiscordChanges(before, changes) }, fallback: async () => ({ status: 299 }) });
  const res = await h({ method: "PUT", url: "/api/settings", headers: { "content-type": "application/json" }, body: JSON.stringify({ discord: { name: "{bogus}" } }) });
  assert.equal(res.status, 400);
  assert.match(JSON.parse(res.body).message, /unknown field \{bogus\}/);
  const ok = await h({ method: "PUT", url: "/api/settings", headers: { "content-type": "application/json" }, body: JSON.stringify({ discord: { name: "{artist}" } }) });
  assert.equal(ok.status, 200);
  const script = (await h({ url: "/settings.js" })).body;
  assert.match(script, /Status text:/);
});

test("the help lists every valid field", async () => {
  const { templateFields } = await import("../src/template.js");
  const h = createSettingsPageHandler({ settings: { read: () => ({ discord: { enabled: true } }), updateDiscord: async () => {} }, fallback: async () => ({ status: 299 }) });
  const help = /id="discord-name-help">([^<]*)</.exec((await h({ url: "/settings" })).body)[1];
  for (const field of templateFields) assert.ok(help.includes("{" + field + "}"), field);
});
