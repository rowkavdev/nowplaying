import test from "node:test";
import assert from "node:assert/strict";
import { artworkResolverOptions, createDiscordArtworkResolver } from "../src/discord-artwork.js";
import { createLitterboxUploader } from "../src/discord-artwork-upload.js";
import { createSetupConfig } from "../src/setup-config.js";
import { validateSettings } from "../src/settings.js";
import { applyDiscordChanges, discordSettingsView } from "../src/app-settings.js";
import { parseAppConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const dataUri = `data:image/png;base64,${PNG.toString("base64")}`;
const ref = { provider: "plex", itemId: "1", sourceIndex: 0 };

test("a private server cover is uploaded and Discord gets only the public URL", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, form: init.body });
    return new Response("https://litter.catbox.moe/abc123.png\n", { status: 200 });
  };
  const upload = createLitterboxUploader({ coverSource: async () => ({ dataUri }), fetchImpl });
  const resolver = createDiscordArtworkResolver(artworkResolverOptions({ artworkLookup: "off" }, { coverSource: async () => ({ dataUri }), fetchImpl }));
  const result = await resolver.resolve({ kind: "track", title: "Song", artist: "Band", artwork: ref, artworkUrl: "http://192.168.1.4:32400/photo?X-Plex-Token=secret" });
  assert.equal(result.strategy, "upload");
  assert.equal(result.image, "https://litter.catbox.moe/abc123.png");
  assert.equal(result.failure, "not_https");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://litterbox.catbox.moe/resources/internals/api.php");
  assert.equal(seen[0].form.get("time"), "72h");
  assert.equal(seen[0].form.get("reqtype"), "fileupload");
  const file = seen[0].form.get("fileToUpload");
  assert.equal(Buffer.from(await file.arrayBuffer()).equals(PNG), true);
  assert.deepEqual([...seen[0].form.keys()].sort(), ["fileToUpload", "reqtype", "time"], "no title, artist, token or address is sent");
  assert.equal(typeof upload, "function");
});

test("an upload that fails falls back to the icon and reports a short class", async () => {
  const resolver = createDiscordArtworkResolver(artworkResolverOptions({ artworkLookup: "off" }, { coverSource: async () => ({ dataUri }), fetchImpl: async () => new Response("nope", { status: 500 }) }));
  const result = await resolver.resolve({ artwork: ref });
  assert.equal(result.strategy, "fallback");
  assert.equal(result.failure, "upload_error");
  const junk = createDiscordArtworkResolver(artworkResolverOptions({ artworkLookup: "off" }, { coverSource: async () => ({ dataUri }), fetchImpl: async () => new Response("<html>error</html>", { status: 200 }) }));
  assert.equal((await junk.resolve({ artwork: ref })).strategy, "fallback");
});

test("it is on unless turned off, and a missing cover is a miss", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response("https://litter.catbox.moe/x.png"); };
  const coverSource = async () => ({ dataUri });
  for (const settings of [{}, { artworkLookup: "off" }, { artworkUpload: true }]) {
    const resolver = createDiscordArtworkResolver(artworkResolverOptions(settings, { coverSource, fetchImpl }));
    assert.equal((await resolver.resolve({ artwork: ref })).strategy, "upload");
  }
  assert.equal(calls, 3);
  const off = createDiscordArtworkResolver(artworkResolverOptions({ artworkUpload: false }, { coverSource, fetchImpl }));
  assert.equal((await off.resolve({ artwork: ref })).strategy, "fallback");
  assert.equal(calls, 3, "nothing is uploaded once it is turned off");
  const miss = createDiscordArtworkResolver(artworkResolverOptions({}, { coverSource: async () => null, fetchImpl }));
  assert.equal((await miss.resolve({ artwork: ref })).failure, "upload_miss");
  assert.equal(calls, 3);
});

test("MusicBrainz is still the fallback when the upload fails", async () => {
  const options = artworkResolverOptions({ artworkLookup: "musicbrainz" }, { coverSource: async () => ({ dataUri }), fetchImpl: async () => new Response("no", { status: 500 }), createLookup: () => async () => "https://coverartarchive.org/release/1/front" });
  const result = await createDiscordArtworkResolver(options).resolve({ artwork: ref, kind: "track", title: "t", artist: "a" });
  assert.equal(result.strategy, "lookup");
  assert.equal(result.failure, "upload_error");
});

test("artworkUpload is a boolean setting that defaults to on and is written only when off", () => {
  const base = { servers: [{ provider: "plex", serverUrl: "http://127.0.0.1:32400", identity: { id: "u", displayName: "u" } }], credentialStored: true };
  assert.equal("artworkUpload" in createSetupConfig(base).discord, false);
  assert.equal(createSetupConfig({ ...base, discordArtworkUpload: false }).discord.artworkUpload, false);
  assert.throws(() => createSetupConfig({ ...base, discordArtworkUpload: "no" }), /discordArtworkUpload must be a boolean/);
  assert.doesNotThrow(() => validateSettings({ discord: { artworkUpload: false } }));
  assert.throws(() => validateSettings({ discord: { artworkUpload: "no" } }), /artworkUpload/);
  assert.deepEqual(discordSettingsView({ discord: {} }).artworkUpload, true);
  assert.equal(discordSettingsView({ discord: { artworkUpload: false } }).artworkUpload, false);
  const turnedOff = applyDiscordChanges({ ...parseAppConfig(serializeSetupConfig(base)) }, { artworkUpload: false });
  assert.equal(turnedOff.config.discord.artworkUpload, false);
  const back = applyDiscordChanges(turnedOff.config, { artworkUpload: true });
  assert.equal("artworkUpload" in back.config.discord, false);
});

test("a config saved with the old artworkLookup upload value still loads, with upload on", async () => {
  const { parseAppConfig } = await import("../src/app-config.js");
  const { serializeSetupConfig } = await import("../src/setup-config.js");
  const text = serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true });
  const doc = JSON.parse(text);
  doc.discord = { ...doc.discord, artworkLookup: "upload" };
  const config = parseAppConfig(JSON.stringify(doc));
  assert.equal(config.discord.artworkLookup, "off");
  assert.notEqual(config.discord.artworkUpload, false);
});
