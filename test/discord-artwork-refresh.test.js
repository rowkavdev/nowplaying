import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { startAppFromConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";

test("the app's artwork refresh clears the server cover cache before retrying its upload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "np-cover-refresh-"));
  const file = join(directory, "config.json");
  const config = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "user-1", displayName: "Test User" }, credentialStored: true, discordArtworkUpload: true, discordArtworkLookup: "off" };
  await writeFile(file, serializeSetupConfig(config));
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#6757a0" } }).png().toBuffer();
  let available = false, coverRequests = 0, uploads = 0, clock = Date.parse("2026-10-10T15:00:00Z");
  const sets = [];
  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://litterbox.catbox.moe/")) { uploads += 1; return new Response("https://litter.catbox.moe/refreshed.png"); }
    if (String(url).includes("/Images/Primary")) { coverRequests += 1; return available ? new Response(png, { headers: { "Content-Type": "image/png" } }) : new Response(null, { status: 404 }); }
    if (String(url).endsWith("/Sessions")) return Response.json([{ UserId: "user-1", NowPlayingItem: { Id: "song-1", Type: "Audio", Name: "Example Song", Artists: ["Example Artist"], ImageTags: { Primary: "cover-1" } }, PlayState: { IsPaused: true } }]);
    throw new Error("Unexpected test request");
  };
  const transport = { connect: async () => {}, setActivity: async (activity) => { sets.push(activity); }, clearActivity: async () => {}, close: async () => {} };
  let app;
  try {
    app = await startAppFromConfig({ configFile: file, credentialStore: { read: async (ref) => ref.provider === "jellyfin" ? "test-token" : null }, port: 0, fetchImpl, discord: { createTransport: () => transport, intervalMs: 60_000, now: () => clock } });
    const deadline = Date.now() + 3000;
    while (app.status.snapshot().discord.artwork?.source !== "fallback") {
      assert.ok(Date.now() < deadline, "initial missing cover should reach fallback");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(coverRequests, 1);
    available = true;
    clock += 20_000;
    await app.refreshArtwork();
    assert.equal(coverRequests, 2, "Refresh must bypass the cached 404 without waiting 60 seconds");
    assert.equal(uploads, 1);
    assert.equal(app.status.snapshot().discord.artwork.source, "upload");
    assert.equal(sets.at(-1).largeImage, "https://litter.catbox.moe/refreshed.png");
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
