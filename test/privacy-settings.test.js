import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyPrivacyChanges, privacySettingsView } from "../src/app-settings.js";
import { parseAppConfig, privacyPolicyFromConfig, startAppFromConfig, startDiscordFromConfig, withPrivacy } from "../src/app-config.js";
import { createPresence } from "../src/presence.js";
import { serializeSetupConfig } from "../src/setup-config.js";

// Privacy settings (#253): one policy for Discord, the hosted card and the local card.
const USER = "a1b2c3d4-0000-0000-0000-000000000001";
const JELLYFIN = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: USER, displayName: "Rowan" }, credentialStored: true, discordArtworkLookup: "musicbrainz" };
const OFF = { hideTitles: false, hideArtwork: false, hideProgress: false, hideMovies: false, hideEpisodes: false, hideMusic: false };
const episode = createPresence({ state: "playing", kind: "episode", title: "The Secret Episode", subtitle: "Secret Show", series: "Secret Show", season: 2, episode: 5, year: 2024, artworkUrl: "https://img.example/ep.jpg", positionMs: 1000, durationMs: 60_000 });

async function configFile(input = JELLYFIN) {
  const dir = await mkdtemp(join(tmpdir(), "np-privacy-"));
  const file = join(dir, "config.json");
  await writeFile(file, serializeSetupConfig(input));
  return file;
}

test("older configs hide nothing, and setup's own output is unchanged", () => {
  const config = parseAppConfig(serializeSetupConfig(JELLYFIN));
  assert.equal(config.privacy, undefined);
  assert.deepEqual({ ...privacySettingsView(config) }, OFF);
});

test("saves privacy choices to config.json in policy terms and reads them back", () => {
  const before = parseAppConfig(serializeSetupConfig(JELLYFIN));
  const { config, text } = applyPrivacyChanges(before, { hideTitles: true, hideEpisodes: true, hideMusic: true });
  assert.deepEqual(JSON.parse(text).privacy, { redactTitles: true, hideArtwork: false, hideProgress: false, suppressMediaKinds: ["episode", "track"] });
  assert.deepEqual({ ...privacySettingsView(config) }, { ...OFF, hideTitles: true, hideEpisodes: true, hideMusic: true });
  assert.deepEqual(config.identity, before.identity);
  assert.deepEqual({ ...config.discord }, { ...before.discord });
  // A second change keeps the first.
  const next = applyPrivacyChanges(config, { hideArtwork: true }).config;
  assert.deepEqual({ ...privacySettingsView(next) }, { ...OFF, hideTitles: true, hideArtwork: true, hideEpisodes: true, hideMusic: true });
});

test("rejects unknown privacy keys and bad values", () => {
  const config = parseAppConfig(serializeSetupConfig(JELLYFIN));
  assert.throws(() => applyPrivacyChanges(config, {}), TypeError);
  assert.throws(() => applyPrivacyChanges(config, { mode: "private" }), TypeError);
  assert.throws(() => applyPrivacyChanges(config, { hideTitles: "yes" }), TypeError);
  assert.throws(() => serializeSetupConfig({ ...JELLYFIN, privacy: { suppressMediaKinds: ["podcast"] } }), TypeError);
  assert.throws(() => serializeSetupConfig({ ...JELLYFIN, privacy: { hideUsers: true } }), TypeError);
  assert.throws(() => serializeSetupConfig({ ...JELLYFIN, privacy: [] }), TypeError);
  const hand = JSON.parse(serializeSetupConfig(JELLYFIN));
  hand.privacy = { redactTitles: "no" };
  assert.throws(() => parseAppConfig(JSON.stringify(hand)), { name: "StartupError" });
});

test("hidden titles also hide the series, episode code and year", async () => {
  const provider = withPrivacy({ getPresence: async () => episode }, () => ({ privacy: { redactTitles: true, hideArtwork: true, hideProgress: true } }));
  const p = await provider.getPresence();
  assert.equal(p.title, "Private media");
  for (const key of ["subtitle", "series", "season", "episode", "year", "artworkUrl", "artwork", "positionMs", "durationMs"]) assert.equal(p[key], null, key);
  assert.equal(p.state, "playing");
});

test("hidden media kinds show as nothing playing; episodes also cover whole shows", async () => {
  let presence = episode;
  const provider = withPrivacy({ getPresence: async () => presence }, () => ({ privacy: { suppressMediaKinds: ["episode"] } }));
  assert.equal((await provider.getPresence()).state, "idle");
  presence = createPresence({ ...episode, kind: "show" });
  assert.equal((await provider.getPresence()).state, "idle");
  presence = createPresence({ state: "playing", kind: "track", title: "Song" });
  assert.equal((await provider.getPresence()).title, "Song");
  assert.deepEqual([...privacyPolicyFromConfig({ privacy: { suppressMediaKinds: ["episode"] } }).suppressMediaKinds], ["episode", "show"]);
});

test("with nothing hidden the provider's result passes through untouched", async () => {
  const provider = withPrivacy({ getPresence: async () => episode, other: 1 }, () => ({}));
  assert.equal(await provider.getPresence(), episode);
  assert.equal(provider.other, 1);
});

test("Discord never sends the real title or looks covers up by title when titles are hidden", async () => {
  const sets = [];
  const transport = { connect: async () => {}, setActivity: async (a) => sets.push(a), clearActivity: async () => {}, close: async () => {} };
  const lookups = [];
  const config = { discord: { enabled: true, idleBehavior: "clear", artworkLookup: "musicbrainz" }, privacy: { redactTitles: true } };
  const provider = withPrivacy({ getPresence: async () => episode }, () => config);
  const d = startDiscordFromConfig(config, provider, {
    env: { NOWPLAYING_DISCORD_CLIENT_ID: "123456789012345678" }, createTransport: () => transport, intervalMs: 3_600_000,
    createArtwork: (settings) => { lookups.push(settings.artworkLookup); return undefined; },
  });
  try {
    const deadline = Date.now() + 5000;
    while (sets.length === 0) {
      if (Date.now() >= deadline) assert.fail("timed out waiting for initial private Discord activity");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(lookups, ["off"]);
    assert.equal(sets.length, 1);
    assert.doesNotMatch(JSON.stringify(sets[0]), /Secret/);
    assert.match(JSON.stringify(sets[0]), /Private media/);
  } finally {
    await d.stop();
  }
});

test("the settings page saves privacy and the card follows straight away", async () => {
  const file = await configFile();
  const fetchImpl = async (url) => Response.json(String(url).includes("/Sessions") ? [{ UserId: USER.replaceAll("-", ""), UserName: "Rowan", NowPlayingItem: { Type: "Audio", Name: "Secret Song", Artists: ["Secret Artist"], Album: "B", RunTimeTicks: 1_000_000_000 }, PlayState: { IsPaused: false, PositionTicks: 10_000_000 } }] : []);
  const app = await startAppFromConfig({ configFile: file, credentialStore: { read: async () => "jf-token" }, port: 0, fetchImpl, discord: { env: {}, builtInClientId: "" } });
  try {
    const cookie = (await fetch(`${app.url}/settings`)).headers.get("set-cookie").split(";")[0];
    const put = (body) => fetch(`${app.url}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
    assert.match(await (await fetch(`${app.url}/card.svg`)).text(), /Secret Song/);
    assert.deepEqual((await (await fetch(`${app.url}/api/settings`, { headers: { Cookie: cookie } })).json()).privacy, OFF);
    const saved = await put({ privacy: { hideTitles: true } });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).privacy.hideTitles, true);
    const card = await (await fetch(`${app.url}/card.svg`)).text();
    assert.doesNotMatch(card, /Secret/);
    assert.match(card, /Private media/);
    assert.equal(JSON.parse(await readFile(file, "utf8")).privacy.redactTitles, true);
    await put({ privacy: { hideTitles: false, hideMusic: true } });
    assert.doesNotMatch(await (await fetch(`${app.url}/card.svg`)).text(), /Secret/);
    assert.equal((await put({ privacy: { hideTitles: "maybe" } })).status, 400);
  } finally {
    await app.close();
  }
});
