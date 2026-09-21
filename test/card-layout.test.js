import test from "node:test";
import assert from "node:assert/strict";
import { renderCard } from "../src/card.js";
import { createPresence } from "../src/presence.js";

const presence = createPresence({ state: "playing", kind: "movie", title: "Arrival", subtitle: "2016 · Denis Villeneuve", positionMs: 1, durationMs: 2, updatedAt: 0 });

test("renders bounded layout and typography controls", () => {
  const svg = renderCard(presence, { width: 500, layout: { padding: 32, radius: 18, titleSize: 26, subtitleSize: 16, progressHeight: 8 } });
  assert.match(svg, /rx="18"/);
  assert.match(svg, /font-size="26"/);
  assert.match(svg, /font-size="16"/);
  assert.match(svg, /height="8"/);
  assert.match(svg, /x="32"/);
});

test("rejects unknown and out-of-range layout values", () => {
  assert.throws(() => renderCard(presence, { layout: { gap: 4 } }), /Unknown card layout setting/);
  assert.throws(() => renderCard(presence, { layout: { padding: 100 } }), /12 to 48/);
  assert.throws(() => renderCard(presence, { layout: { titleSize: 8 } }), /14 to 30/);
});
