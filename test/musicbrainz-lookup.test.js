import test from "node:test";
import assert from "node:assert/strict";
import { createMusicBrainzLookup, luceneTerm, MUSICBRAINZ_USER_AGENT } from "../src/musicbrainz-lookup.js";
import { artworkResolverOptions, createDiscordArtworkResolver } from "../src/discord-artwork.js";
import { createSettings, validateSettings } from "../src/settings.js";

const RELEASE = "0f2a4a5e-1111-4222-8333-444455556666";
const OTHER = "9a2a4a5e-1111-4222-8333-444455556666";

function fakeNetwork({ recordings, covers = {} }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith("https://musicbrainz.org/")) return { ok: true, status: 200, json: async () => ({ recordings }) };
    const id = url.split("/")[4];
    return { ok: false, status: covers[id] ?? 404 };
  };
  return { calls, fetchImpl };
}

test("finds the Cover Art Archive front cover for the best confident match", async () => {
  const net = fakeNetwork({ recordings: [{ score: 100, releases: [{ id: OTHER }, { id: RELEASE }] }, { score: 40, releases: [{ id: "bad" }] }], covers: { [RELEASE]: 307 } });
  const lookup = createMusicBrainzLookup({ fetchImpl: net.fetchImpl, minIntervalMs: 0 });
  assert.equal(await lookup({ title: "Teardrop", artist: "Massive Attack" }), `https://coverartarchive.org/release/${RELEASE}/front-250`);
  const search = new URL(net.calls[0].url);
  assert.equal(search.searchParams.get("query"), 'recording:"Teardrop" AND artist:"Massive Attack"');
  assert.equal(net.calls[0].init.headers["User-Agent"], MUSICBRAINZ_USER_AGENT);
  assert.deepEqual(net.calls.slice(1).map((call) => call.init.method), ["HEAD", "HEAD"]);
});

test("returns null for weak matches, missing covers and blank titles", async () => {
  const weak = fakeNetwork({ recordings: [{ score: 60, releases: [{ id: RELEASE }] }], covers: { [RELEASE]: 307 } });
  assert.equal(await createMusicBrainzLookup({ fetchImpl: weak.fetchImpl, minIntervalMs: 0 })({ title: "x", artist: "y" }), null);
  const noCover = fakeNetwork({ recordings: [{ score: 100, releases: [{ id: RELEASE }] }] });
  assert.equal(await createMusicBrainzLookup({ fetchImpl: noCover.fetchImpl, minIntervalMs: 0 })({ title: "x" }), null);
  const blank = fakeNetwork({ recordings: [] });
  assert.equal(await createMusicBrainzLookup({ fetchImpl: blank.fetchImpl })({ title: "  " }), null);
  assert.equal(blank.calls.length, 0);
});

test("escapes query syntax and sends only title and artist", async () => {
  assert.equal(luceneTerm('a "b" \\ c'), '"a \\"b\\" \\\\ c"');
  const net = fakeNetwork({ recordings: [] });
  await createMusicBrainzLookup({ fetchImpl: net.fetchImpl, minIntervalMs: 0 })({ title: 'x" OR artist:"*', artist: "y", user: "rowan", filePath: "C:\\Music" });
  const url = net.calls[0].url;
  assert.doesNotMatch(url, /rowan|Music/);
  assert.equal(new URL(url).searchParams.get("query"), 'recording:"x\\" OR artist:\\"*" AND artist:"y"');
});

test("spaces every request at least one second apart", async () => {
  let clock = 0; const waits = [];
  const net = fakeNetwork({ recordings: [{ score: 100, releases: [{ id: RELEASE }] }], covers: { [RELEASE]: 200 } });
  const lookup = createMusicBrainzLookup({ fetchImpl: net.fetchImpl, now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
  await Promise.all([lookup({ title: "a" }), lookup({ title: "b" })]);
  assert.equal(net.calls.length, 4);
  assert.deepEqual(waits, [1100, 1100, 1100]);
  assert.throws(() => createMusicBrainzLookup({ userAgent: "nowplaying" }), /contact/);
});

test("stays off by default and is enabled only by artworkLookup: musicbrainz", async () => {
  assert.equal(createSettings().discord.artworkLookup, "off");
  assert.deepEqual(artworkResolverOptions(createSettings().discord), { publicProxyBase: "", metadataLookup: false });
  assert.throws(() => validateSettings({ discord: { artworkLookup: "itunes" } }), /artworkLookup/);
  const lookup = async () => `https://coverartarchive.org/release/${RELEASE}/front-250`;
  const options = artworkResolverOptions(createSettings({ discord: { artworkLookup: "musicbrainz" } }).discord, { createLookup: () => lookup });
  assert.equal(options.metadataLookup, true);
  const result = await createDiscordArtworkResolver(options).resolve({ title: "Teardrop", artist: "Massive Attack" });
  assert.deepEqual([result.strategy, result.image], ["lookup", `https://coverartarchive.org/release/${RELEASE}/front-250`]);
});
