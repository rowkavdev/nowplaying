import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import sharp from "sharp";
import { compactHostedArtwork } from "../src/hosted-artwork.js";
import { isHostedArtwork, MAX_HOSTED_ARTWORK_LENGTH } from "../src/hosted-artwork-format.js";
import { projectHostedState } from "../src/hosted-projection.js";
import { createHostedUploader } from "../src/hosted-uploader.js";
import { createPublicCardArtwork } from "../src/artwork-public.js";
import { createHandlers } from "../hosted/lib/app.js";
import { createService, validateIngest } from "../hosted/lib/service.js";
import { createMemoryRedis } from "../hosted/lib/redis.js";
import { cardPresets } from "../src/card-presets.js";
import { previewArtwork } from "../src/setup-preview.js";
import { applyHostedChanges } from "../src/app-settings.js";
import { parseAppConfig, hostedUploadSettings } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";

const track = { state: "playing", kind: "track", title: "Blue Monday", subtitle: "New Order", artwork: { provider: "jellyfin", itemId: "private-item-id", type: "primary" }, positionMs: 83000, durationMs: 448000 };

test("cover sharing is explicit, survives saves, and respects privacy before projection", async () => {
  const base = parseAppConfig(serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "fixture", displayName: "Fixture" }, credentialStored: true, hostedEnabled: true }));
  assert.equal(hostedUploadSettings(base).shareArtwork, false);
  const enabled = applyHostedChanges(base, { artwork: true }).config;
  assert.equal(enabled.hosted.enabled, true);
  assert.equal(parseAppConfig(JSON.stringify(enabled)).hosted.artwork, true);
  assert.equal(applyHostedChanges(enabled, { enabled: false }).config.hosted.artwork, true);
  assert.throws(() => applyHostedChanges(base, { artwork: "yes" }), TypeError);
  const artworkDataUri = await compactHostedArtwork(await previewArtwork("film"));
  assert.ok(isHostedArtwork(artworkDataUri));
  for (const settings of [{}, { shareArtwork: true, privacy: { hideArtwork: true } }, { shareArtwork: true, privacy: { redactTitles: true } }, { shareArtwork: true, privacy: { mode: "private" } }, { shareArtwork: true, privacy: { suppressMediaKinds: ["track"] } }, { shareArtwork: true, show: { artwork: false } }]) {
    assert.equal(projectHostedState(track, settings, { seq: 1, artworkDataUri }).artworkDataUri, undefined);
  }
  assert.equal(projectHostedState(track, { shareArtwork: true }, { seq: 1, artworkDataUri }).artworkDataUri, artworkDataUri);
});

test("public art rejects arbitrary hosts and credentials, and sanitizes allowed CDN images", async () => {
  const bytes = Buffer.from((await previewArtwork("music")).split(",")[1], "base64");
  const calls = [];
  const service = createPublicCardArtwork({ fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(bytes, { headers: { "Content-Type": "image/jpeg" } }); } });
  for (const url of ["http://i.scdn.co/image/a", "https://evil.test/a", "https://i.scdn.co.evil.test/a", "https://user:secret@i.scdn.co/image/a", "https://127.0.0.1/a", "https://i.scdn.co:8096/a"]) assert.equal(await service.resolve(url), null);
  assert.equal(calls.length, 0);
  const uri = await service.resolve("https://i.scdn.co/image/fixture");
  assert.match(uri, /^data:image\/png;base64,/);
  await service.resolve("https://i.scdn.co/image/fixture");
  assert.equal(calls.length, 1, "repeated frames reuse the sanitized cover");
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test("host rejects links, SVG, malformed PNG, metadata, oversized images and payloads", async () => {
  const clean = await compactHostedArtwork(await previewArtwork("film"));
  const huge = await sharp({ create: { width: 300, height: 300, channels: 3, background: "blue" } }).png().toBuffer();
  const metadata = await sharp({ create: { width: 16, height: 16, channels: 3, background: "blue" } }).withMetadata().png().toBuffer();
  const invalid = ["https://server/private?token=secret", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,eA==", clean + "AAAA", "data:image/png;base64," + huge.toString("base64"), "data:image/png;base64," + metadata.toString("base64"), clean + "A".repeat(MAX_HOSTED_ARTWORK_LENGTH)];
  for (const artworkDataUri of invalid) {
    assert.equal(isHostedArtwork(artworkDataUri), false);
    assert.throws(() => validateIngest({ v: 1, seq: 1, observedAt: Date.now(), state: "playing", artworkDataUri }), { code: "invalid_artwork" });
  }
});

test("actual HTTP upload, stored state and public SVG retain images for music, movies and TV in every style", async () => {
  const service = createService({ redis: createMemoryRedis() });
  const handlers = createHandlers({ getService: () => service });
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://local").pathname;
    const handler = ({ "/api/register": handlers.register, "/api/ingest": handlers.ingest, "/api/revoke": handlers.revoke })[path] ?? handlers.card;
    handler(req, res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let stored, settings = { shareArtwork: true }, currentArt, lookups = 0;
  const payloads = [];
  const uploader = createHostedUploader({ baseUrl, credentials: { load: async () => stored, save: async value => { stored = value; }, clear: async () => { stored = null; } }, settings: () => settings,
    resolveArtwork: async () => { lookups++; return currentArt; },
    fetchImpl: async (url, init) => { if (url.endsWith("/api/ingest")) payloads.push(JSON.parse(init.body)); return fetch(url, init); },
  });
  try {
    for (const [kind, example] of [["track", "music"], ["movie", "film"], ["episode", "episode"]]) {
      currentArt = await previewArtwork(example);
      const presence = { ...track, kind, title: `${kind} test` };
      assert.equal((await uploader.push(presence)).sent, true);
      const url = await uploader.cardUrl();
      const state = await service.readCardState(stored.cardId);
      assert.ok(isHostedArtwork(state.artworkDataUri), "image survives storage and the public state projection");
      assert.ok(JSON.stringify(payloads.at(-1)).length > 2048, "real art is larger than the old text-only request limit");
      for (const theme of Object.keys(cardPresets)) for (const width of [280, 440, 800]) {
        const res = await fetch(`${url}?theme=${theme}&width=${width}`);
        assert.equal(res.status, 200);
        const svg = await res.text();
        assert.doesNotMatch(svg, /private-item-id|jellyfin|https?:\/\/(?!www.w3.org)/);
        if (theme === "compact") assert.doesNotMatch(svg, /<image /);
        else assert.match(svg, /<image href="data:image\/png;base64,/);
        const info = await sharp(Buffer.from(svg)).metadata();
        assert.equal(info.width, width);
        await sharp(Buffer.from(svg)).png().toBuffer();
      }
      settings = { shareArtwork: true, privacy: { hideArtwork: true } };
      const before = lookups;
      await uploader.push(presence);
      assert.equal(lookups, before, "hidden art is not even resolved");
      assert.equal((await service.readCardState(stored.cardId)).artworkDataUri, undefined, "privacy removes the previously stored cover");
      settings = { shareArtwork: true };
      await uploader.push({ ...presence, state: "idle" });
      assert.equal((await service.readCardState(stored.cardId)).artworkDataUri, undefined);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("turning sharing off during registration prevents a prepared cover from reaching the wire", async () => {
  let settings = { shareArtwork: true }, stored, release, entered;
  const registering = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  let sent;
  const art = await previewArtwork("music");
  const uploader = createHostedUploader({ baseUrl: "https://cards.example", settings: () => settings,
    credentials: { load: async () => stored, save: async value => { stored = value; }, clear: async () => {} }, resolveArtwork: async () => art,
    fetchImpl: async (url, init) => {
      if (url.endsWith("/api/register")) { entered(); await barrier; return Response.json({ cardId: "c".repeat(22), deviceId: "d".repeat(22), token: "t".repeat(43) }, { status: 201 }); }
      sent = JSON.parse(init.body); return Response.json({ accepted: true }, { status: 202 });
    },
  });
  const pending = uploader.push(track);
  await registering;
  settings = { shareArtwork: false };
  release();
  assert.equal((await pending).sent, true);
  assert.equal(sent.artworkDataUri, undefined);
  assert.equal(sent.title, track.title);
});
