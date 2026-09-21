import test from "node:test";
import assert from "node:assert/strict";
import { createSettings } from "../src/settings.js";
import { renderCard } from "../src/card.js";
import { createPresence } from "../src/presence.js";

test("default and customized card settings render directly", () => {
  const presence = createPresence({ state: "playing", kind: "track", title: "Song" });
  assert.doesNotThrow(() => renderCard(presence, createSettings().card));
  const settings = createSettings({ card: { layout: { padding: 36, titleSize: 24 }, show: { subtitle: false } } });
  const svg = renderCard(presence, settings.card);
  assert.match(svg, /font-size="24"/);
  assert.match(svg, /x="36"/);
});

test("settings reject renderer-unknown visibility keys", () => {
  assert.throws(() => createSettings({ card: { show: { provider: true } } }), /card.show.provider: unknown setting/);
  assert.throws(() => createSettings({ card: { layout: { padding: 60 } } }), /card.layout.padding/);
});
