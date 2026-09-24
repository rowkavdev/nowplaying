import test from "node:test";
import assert from "node:assert/strict";
import { cardRenderOptions, createSetupConfig, serializeSetupConfig } from "../src/setup-config.js";
import { parseAppConfig } from "../src/app-config.js";
import { applyCardChanges, applyDiscordChanges } from "../src/app-settings.js";
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

test("artwork placement and size are saved and reach the renderer", () => {
  const card = { artworkPosition: "right", artworkWidth: 120, artworkHeight: 120 };
  const config = parseAppConfig(serializeSetupConfig({ ...BASE, card }));
  assert.deepEqual({ ...config.card }, card);
  assert.deepEqual(JSON.parse(JSON.stringify(cardRenderOptions(config.card))), { layout: card });
});

test("saving from the settings page keeps artwork placement", () => {
  const config = parseAppConfig(serializeSetupConfig({ ...BASE, card: { artworkPosition: "right", artworkWidth: 90 } }));
  const next = applyCardChanges(config, { radius: 4 }).config;
  assert.equal(next.card.artworkPosition, "right");
  assert.equal(next.card.artworkWidth, 90);
  assert.equal(next.card.radius, 4);
});

test("field order and text alignment are saved and reach the renderer", () => {
  const card = { fieldOrder: ["title", "subtitle", "state"], textAlign: "middle" };
  const config = parseAppConfig(serializeSetupConfig({ ...BASE, card }));
  assert.deepEqual(JSON.parse(JSON.stringify(config.card)), card);
  assert.deepEqual(JSON.parse(JSON.stringify(cardRenderOptions(config.card))), { layout: card });
  const next = applyCardChanges(config, { textAlign: "end" }).config;
  assert.deepEqual([...next.card.fieldOrder], ["title", "subtitle", "state"]);
  assert.equal(next.card.textAlign, "end");
});

test("progress bar and text direction settings are saved and reach the renderer", () => {
  const card = { progressPosition: "text", progressWidth: "full", direction: "auto" };
  const config = parseAppConfig(serializeSetupConfig({ ...BASE, card }));
  assert.deepEqual({ ...config.card }, card);
  assert.deepEqual(JSON.parse(JSON.stringify(cardRenderOptions(config.card))), { layout: card });
});

test("an empty card section is left out of the file", () => {
  assert.equal(JSON.parse(serializeSetupConfig({ ...BASE, card: {} })).card, undefined);
});

test("bad card values are rejected", () => {
  for (const card of [[], "paper", { theme: "neon" }, { width: 100 }, { width: 500.5 }, { padding: 60 }, { radius: -1 }, { progressHeight: 20 }, { showProgress: "no" }, { colors: {} }, { artworkPosition: "top" }, { artworkWidth: 40 }, { artworkWidth: 200 }, { artworkHeight: 181 }, { artworkHeight: 90.5 }, { textAlign: "center" }, { progressPosition: "top" }, { progressWidth: "half" }, { direction: "sideways" }, { fieldOrder: ["title"] }, { fieldOrder: ["title", "title", "state"] }, { fieldOrder: "title,state,subtitle" }]) {
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
