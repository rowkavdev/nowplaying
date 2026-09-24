import test from "node:test";
import assert from "node:assert/strict";
import { cardRenderOptions, createSetupConfig, serializeSetupConfig } from "../src/setup-config.js";
import { parseAppConfig } from "../src/app-config.js";
import { applyDiscordChanges } from "../src/app-settings.js";
import { createCardPipeline } from "../src/card-pipeline.js";

const BASE = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true };

test("older configs have no card section and render with defaults", () => {
  const config = parseAppConfig(serializeSetupConfig(BASE));
  assert.equal(config.card, undefined);
  assert.deepEqual({ ...cardRenderOptions(config.card) }, {});
});

test("a saved card section survives parse and maps to renderer options", () => {
  const card = { theme: "paper", width: 500, padding: 16, radius: 0, progressHeight: 8, showProgress: false };
  const config = parseAppConfig(serializeSetupConfig({ ...BASE, card }));
  assert.deepEqual({ ...config.card }, card);
  assert.deepEqual(JSON.parse(JSON.stringify(cardRenderOptions(config.card))), { theme: "paper", width: 500, layout: { padding: 16, radius: 0, progressHeight: 8 }, show: { progress: false } });
});

test("an empty card section is left out of the file", () => {
  assert.equal(JSON.parse(serializeSetupConfig({ ...BASE, card: {} })).card, undefined);
});

test("bad card values are rejected", () => {
  for (const card of [[], "paper", { theme: "neon" }, { width: 100 }, { width: 500.5 }, { padding: 60 }, { radius: -1 }, { progressHeight: 20 }, { showProgress: "no" }, { colors: {} }]) {
    assert.throws(() => createSetupConfig({ ...BASE, card }), TypeError, JSON.stringify(card));
  }
  const text = JSON.stringify({ ...JSON.parse(serializeSetupConfig(BASE)), card: { theme: "neon" } });
  assert.throws(() => parseAppConfig(text));
});

test("saving another section keeps the card section", () => {
  const config = parseAppConfig(serializeSetupConfig({ ...BASE, card: { theme: "paper", radius: 4 } }));
  const next = applyDiscordChanges(config, { timestamps: "none" }).config;
  assert.deepEqual({ ...next.card }, { theme: "paper", radius: 4 });
});

test("the card pipeline uses saved options and lets the query win", async () => {
  const seen = [];
  let saved = { theme: "paper", width: 500, layout: { radius: 0 } };
  const resolve = createCardPipeline({ provider: { getPresence: async () => ({ state: "idle" }) }, renderer: (_p, options) => { seen.push(options); return "svg"; }, defaults: () => saved });
  await resolve({});
  await resolve({ theme: "midnight-blue" });
  saved = {};
  await resolve({});
  assert.deepEqual(seen.map(({ artworkDataUri, ...rest }) => rest), [
    { theme: "paper", width: 500, layout: { radius: 0 } },
    { theme: "midnight-blue", width: 500, layout: { radius: 0 } },
    {},
  ]);
  assert.throws(() => createCardPipeline({ provider: { getPresence: async () => ({}) }, defaults: {} }), TypeError);
});
