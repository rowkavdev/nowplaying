import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createSetupHostedHandler } from "../src/setup-hosted-handler.js";
import { createSetupDraft } from "../src/setup.js";
import { hostedUploadSettings, parseAppConfig } from "../src/app-config.js";
import { serializeSetupConfig } from "../src/setup-config.js";
import { setupDraftFromConfig, writeSetupConfig } from "../src/setup-app.js";
import { projectHostedState } from "../src/hosted-projection.js";

const body = (res) => JSON.parse(res.body);

test("preview route lists the fields the current settings would send", async () => {
  const handle = createSetupHostedHandler({ settings: async () => hostedUploadSettings({ card: { theme: "compact" } }) });
  const res = await handle({ method: "GET", url: "/api/setup/hosted/preview" });
  assert.equal(res.status, 200);
  const p = body(res);
  assert.deepEqual(p.sent.map((f) => f.key), ["state", "kind", "title", "subtitle"]);
  assert.deepEqual(p.withheld.map((f) => f.key), ["durationMs", "positionMs"]);
  assert.equal(p.defaultUrl, "https://nowplaying-hosted.vercel.app");
  assert.equal((await handle({ method: "POST", url: "/api/setup/hosted/preview" })).status, 405);
  assert.equal(await handle({ method: "GET", url: "/api/setup/draft" }), null);
  assert.equal((await handle({ method: "GET", url: "/api/setup/hosted/nope" })).status, 404);
});

test("check route validates input and passes only the URL on", async () => {
  const seen = [];
  const handle = createSetupHostedHandler({ checkEndpoint: async (url) => { seen.push(url); return { ok: true, url }; } });
  const ok = await handle({ method: "POST", url: "/api/setup/hosted/check", body: JSON.stringify({ url: "https://cards.example.com" }) });
  assert.deepEqual(body(ok), { ok: true, url: "https://cards.example.com" });
  for (const bad of ["{", "[]", JSON.stringify({}), JSON.stringify({ url: 5 }), JSON.stringify({ url: "https://x", token: "t" })]) {
    assert.equal((await handle({ method: "POST", url: "/api/setup/hosted/check", body: bad })).status, 400);
  }
  assert.equal((await handle({ method: "GET", url: "/api/setup/hosted/check" })).status, 405);
  assert.deepEqual(seen, ["https://cards.example.com"]);
});

test("hosted upload settings withhold progress when the card hides it", () => {
  const presence = { state: "playing", kind: "track", title: "T", subtitle: "A", positionMs: 1000, durationMs: 5000 };
  const hidden = projectHostedState(presence, hostedUploadSettings({ card: { showProgress: false } }), { seq: 1, now: 1 });
  assert.equal(hidden.positionMs, undefined);
  assert.equal(hidden.durationMs, undefined);
  const shown = projectHostedState(presence, hostedUploadSettings({}), { seq: 1, now: 1 });
  assert.equal(shown.positionMs, 1000);
  const redacted = projectHostedState(presence, hostedUploadSettings({ privacy: { redactTitles: true } }), { seq: 1, now: 1 });
  assert.notEqual(redacted.title, "T");
});

test("draft carries the hosting choice and rejects bad URLs", () => {
  assert.equal(createSetupDraft({}).hostedEnabled, null);
  const d = createSetupDraft({ hostedEnabled: true, hostedUrl: "https://cards.example.com/" });
  assert.equal(d.hostedUrl, "https://cards.example.com");
  assert.throws(() => createSetupDraft({ hostedEnabled: "yes" }), /hostedEnabled/);
  assert.throws(() => createSetupDraft({ hostedUrl: "http://cards.example.com" }), /hostedUrl/);
});

test("Finish writes the hosting choice; no choice keeps the installed one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-setup-hosted-"));
  const file = join(dir, "config.json");
  const account = { provider: "jellyfin", id: "u1", displayName: "Rowan", serverUrl: "http://127.0.0.1:8096" };
  await writeSetupConfig(file, { provider: "jellyfin", account, hostedEnabled: true, hostedUrl: "https://cards.example.com" });
  let saved = parseAppConfig(await readFile(file, "utf8"));
  assert.deepEqual({ ...saved.hosted }, { enabled: true, url: "https://cards.example.com" });
  await writeSetupConfig(file, { provider: "jellyfin", account, hostedEnabled: null });
  saved = parseAppConfig(await readFile(file, "utf8"));
  assert.equal(saved.hosted.enabled, true);
  await writeSetupConfig(file, { provider: "jellyfin", account, hostedEnabled: false, hostedUrl: "https://cards.example.com" });
  saved = parseAppConfig(await readFile(file, "utf8"));
  assert.deepEqual({ ...saved.hosted }, { enabled: false });
});

test("setup on an installed app starts from its hosting choice", async () => {
  const config = parseAppConfig(serializeSetupConfig({ servers: [{ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" } }], credentialStored: true, hostedEnabled: true }));
  const draft = setupDraftFromConfig(config);
  assert.equal(draft.hostedEnabled, true);
  assert.equal(draft.hostedUrl, null);
});
