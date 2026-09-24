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

test("field order and text alignment are optional and bounded", () => {
  const presence = { state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 1, durationMs: 4 };
  assert.equal(renderCard(presence, { layout: { fieldOrder: ["state", "title", "subtitle"], textAlign: "start" } }), renderCard(presence));
  const flipped = renderCard(presence, { layout: { fieldOrder: ["title", "subtitle", "state"] } });
  const y = (label) => Number(flipped.match(new RegExp(`<text x="\\d+" y="(\\d+)"[^>]*>${label}<`))[1]);
  assert.ok(y("Song") < y("Artist") && y("Artist") < y("NOW PLAYING"));
  assert.ok(Number(flipped.match(/<svg[^>]* height="(\d+)"/)[1]) >= y("NOW PLAYING") + 24);
  const middle = renderCard(presence, { width: 400, layout: { textAlign: "middle" } });
  assert.match(middle, /<text x="200" y="\d+" text-anchor="middle"[^>]*>Song</);
  const end = renderCard(presence, { width: 400, layout: { textAlign: "end" } });
  assert.match(end, /<text x="376" y="\d+" text-anchor="end"[^>]*>Song</);
  for (const layout of [{ fieldOrder: ["title"] }, { fieldOrder: ["title", "title", "state"] }, { fieldOrder: ["title", "subtitle", "artist"] }, { fieldOrder: "title" }, { textAlign: "center" }, { textAlign: "left" }]) {
    assert.throws(() => renderCard(presence, { layout }), TypeError, JSON.stringify(layout));
  }
});
