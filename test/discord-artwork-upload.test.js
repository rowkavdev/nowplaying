import test from "node:test";
import assert from "node:assert/strict";
import { artworkResolverOptions, createDiscordArtworkResolver } from "../src/discord-artwork.js";
import { createLitterboxUploader } from "../src/discord-artwork-upload.js";
import { createSetupConfig } from "../src/setup-config.js";
import { validateSettings } from "../src/settings.js";

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
  const resolver = createDiscordArtworkResolver(artworkResolverOptions({ artworkLookup: "upload" }, { coverSource: async () => ({ dataUri }), fetchImpl }));
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
  const resolver = createDiscordArtworkResolver(artworkResolverOptions({ artworkLookup: "upload" }, { coverSource: async () => ({ dataUri }), fetchImpl: async () => new Response("nope", { status: 500 }) }));
  const result = await resolver.resolve({ artwork: ref });
  assert.equal(result.strategy, "fallback");
  assert.equal(result.failure, "upload_error");
  const junk = createDiscordArtworkResolver(artworkResolverOptions({ artworkLookup: "upload" }, { coverSource: async () => ({ dataUri }), fetchImpl: async () => new Response("<html>error</html>", { status: 200 }) }));
  assert.equal((await junk.resolve({ artwork: ref })).strategy, "fallback");
});

test("nothing is uploaded unless the setting is on, and a missing cover is a miss", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response("https://litter.catbox.moe/x.png"); };
  for (const artworkLookup of ["off", "musicbrainz"]) {
    const options = artworkResolverOptions({ artworkLookup }, { coverSource: async () => ({ dataUri }), fetchImpl, createLookup: () => async () => null });
    await createDiscordArtworkResolver(options).resolve({ artwork: ref, title: "t", artist: "a" });
  }
  assert.equal(calls, 0);
  const miss = createDiscordArtworkResolver(artworkResolverOptions({ artworkLookup: "upload" }, { coverSource: async () => null, fetchImpl }));
  assert.equal((await miss.resolve({ artwork: ref })).failure, "upload_miss");
  assert.equal(calls, 0);
});

test("upload is an accepted album art setting", () => {
  const base = { servers: [{ provider: "plex", serverUrl: "http://127.0.0.1:32400", identity: { id: "u", displayName: "u" } }], credentialStored: true };
  assert.equal(createSetupConfig({ ...base, discordArtworkLookup: "upload" }).discord.artworkLookup, "upload");
  assert.throws(() => createSetupConfig({ ...base, discordArtworkLookup: "imgur" }), /off, musicbrainz or upload/);
  assert.doesNotThrow(() => validateSettings({ discord: { artworkLookup: "upload" } }));
  assert.throws(() => validateSettings({ discord: { artworkLookup: "imgur" } }), /off, musicbrainz or upload/);
});
