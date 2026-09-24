import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSetupPreviewHandler } from "../src/setup-preview.js";
import { startSetupApp } from "../src/setup-app.js";
import { serializeSetupConfig } from "../src/setup-config.js";

test("serves music, episode and film example cards from the real renderer (#143)", async () => {
  const handle = createSetupPreviewHandler();
  const music = await handle({ url: "/api/setup/preview/music.svg" });
  assert.equal(music.status, 200);
  assert.match(music.headers["Content-Type"], /^image\/svg\+xml/);
  assert.match(music.body, /Blue Monday/);
  assert.match((await handle({ url: "/api/setup/preview/episode.svg" })).body, /S04E05 · The Constant/);
  assert.match((await handle({ url: "/api/setup/preview/film.svg" })).body, /Dune: Part Two \(2024\)/);
  assert.equal(await handle({ url: "/api/setup/preview/other.svg" }), null);
  assert.equal((await handle({ url: "/api/setup/preview/film.svg?x=1" })).status, 400);
  assert.equal((await handle({ method: "POST", url: "/api/setup/preview/film.svg" })).status, 405);
});

test("a bad card look falls back to the default card rather than failing", async () => {
  const handle = createSetupPreviewHandler({ renderOptions: async () => ({ width: 5 }) });
  assert.equal((await handle({ url: "/api/setup/preview/music.svg" })).status, 200);
});

test("the wizard previews use the installed card look", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-preview-"));
  const configFile = join(dir, "config.json");
  await writeFile(configFile, serializeSetupConfig({ servers: [{ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" } }], credentialStored: true, card: { theme: "paper", width: 320 } }));
  const app = await startSetupApp({ draftFile: join(dir, "draft.json"), configFile });
  try {
    const response = await fetch(new URL("/api/setup/preview/film.svg", app.url));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /width="320"/);
  } finally {
    await app.close();
  }
});

test("the card examples page shows all three examples", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-preview-"));
  const app = await startSetupApp({ draftFile: join(dir, "draft.json") });
  try {
    const response = await fetch(new URL("/setup/preview", app.url));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /img-src 'self'/);
    const html = await response.text();
    for (const kind of ["music", "episode", "film"]) assert.match(html, new RegExp(`/api/setup/preview/${kind}\\.svg`));
  } finally {
    await app.close();
  }
});
