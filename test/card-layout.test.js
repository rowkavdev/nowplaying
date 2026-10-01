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
  assert.ok(y("Song") < y("Artist") && y("Artist") < y("Now playing"));
  assert.ok(Number(flipped.match(/<svg[^>]* height="(\d+)"/)[1]) >= y("Now playing") + 24);
  const middle = renderCard(presence, { width: 400, layout: { textAlign: "middle" } });
  assert.match(middle, /<text x="200" y="\d+" text-anchor="middle"[^>]*>Song</);
  const end = renderCard(presence, { width: 400, layout: { textAlign: "end" } });
  assert.match(end, /<text x="376" y="\d+" text-anchor="end"[^>]*>Song</);
  for (const layout of [{ fieldOrder: ["title"] }, { fieldOrder: ["title", "title", "state"] }, { fieldOrder: ["title", "subtitle", "artist"] }, { fieldOrder: "title" }, { textAlign: "center" }, { textAlign: "left" }]) {
    assert.throws(() => renderCard(presence, { layout }), TypeError, JSON.stringify(layout));
  }
});

test("progress bar position and width are optional and bounded", () => {
  const p = { state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 1, durationMs: 2 };
  const art = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(renderCard(p, { artworkDataUri: art, layout: { progressPosition: "bottom", progressWidth: "content" } }), renderCard(p, { artworkDataUri: art }));
  const bar = (svg) => svg.match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="4"/).slice(1).map(Number);
  const height = (svg) => Number(svg.match(/<svg[^>]* height="(\d+)"/)[1]);
  const full = renderCard(p, { width: 440, artworkDataUri: art, layout: { progressWidth: "full" } });
  assert.deepEqual(bar(full).filter((_, i) => i !== 1), [24, 392]);
  assert.ok(bar(full)[1] >= 24 + 100 + 12, "bar sits below the artwork");
  assert.equal(bar(full)[1], height(full) - 24);
  const text = renderCard(p, { width: 440, artworkDataUri: art, layout: { progressPosition: "text" } });
  const subtitleY = Number(text.match(/<text x="\d+" y="(\d+)"[^>]*>Artist</)[1]);
  assert.equal(bar(text)[1], subtitleY + 16);
  assert.ok(bar(text)[1] < height(text) - 24);
  for (const layout of [{ progressPosition: "top" }, { progressWidth: "half" }, { progressWidth: 200 }]) assert.throws(() => renderCard(p, { layout }), TypeError, JSON.stringify(layout));
});

test("right-to-left layout mirrors text, artwork and progress", () => {
  const art = "data:image/png;base64,iVBORw0KGgo=";
  const hebrew = { state: "playing", kind: "track", title: "שלום", subtitle: "אמן", positionMs: 1, durationMs: 4 };
  const latin = { ...hebrew, title: "Song", subtitle: "Artist" };
  assert.equal(renderCard(latin, { artworkDataUri: art, layout: { direction: "ltr" } }), renderCard(latin, { artworkDataUri: art }));
  assert.equal(renderCard(hebrew, { artworkDataUri: art }), renderCard(hebrew, { artworkDataUri: art, layout: { direction: "ltr" } }), "ltr stays the default");
  const rtl = renderCard(hebrew, { width: 440, artworkDataUri: art, layout: { direction: "rtl" } });
  assert.match(rtl, /<image [^>]*x="316"/, "artwork moves to the right");
  assert.match(rtl, /<text x="292" y="\d+" direction="rtl"[^>]*>שלום</, "text starts at the right edge of the text column");
  const [track, fill] = [...rtl.matchAll(/<rect x="(\d+)" y="\d+" width="(\d+)" height="4"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(fill[0] + fill[1], track[0] + track[1], "progress fills from the right");
  assert.equal(renderCard(hebrew, { width: 440, artworkDataUri: art, layout: { direction: "auto" } }), rtl);
  assert.equal(renderCard(latin, { layout: { direction: "auto" } }), renderCard(latin));
  assert.match(renderCard(hebrew, { width: 440, layout: { direction: "rtl", textAlign: "end" } }), /<text x="24" y="\d+" text-anchor="end" direction="rtl"[^>]*>שלום</);
  assert.match(renderCard(hebrew, { artworkDataUri: art, layout: { direction: "rtl", artworkPosition: "left" } }), /<image [^>]*x="24"/, "an explicit side wins");
  for (const layout of [{ direction: "RTL" }, { direction: true }]) assert.throws(() => renderCard(hebrew, { layout }), TypeError);
});

test("flat look options render and reject unknown values", async () => {
  const { renderCard } = await import("../src/card.js");
  const presence = { state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 1, durationMs: 2 };
  const art = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPo6p8BAANYAbKMazHIAAAAAElFTkSuQmCC";
  const flat = renderCard(presence, { artworkDataUri: art });
  assert.doesNotMatch(flat, /Gradient|<circle/);
  assert.match(flat, />Now playing<\/text>/);
  assert.match(renderCard(presence, { layout: { statusStyle: "caps" } }), />NOW PLAYING<\/text>/);
  assert.match(renderCard(presence, { layout: { statusStyle: "dot" } }), /<circle/);
  assert.match(renderCard(presence, { layout: { fontFamily: "mono" } }), /ui-monospace/);
  assert.match(renderCard(presence, { artworkDataUri: art, layout: { artShape: "circle" } }), /id="art"><rect[^>]* rx="50"/);
  assert.match(renderCard(presence, { layout: { progressStyle: "rounded" } }), /height="4" rx="2"/);
  assert.doesNotMatch(renderCard(presence, { layout: { border: "none" } }), /stroke=/);
  for (const bad of [{ fontFamily: "comic" }, { statusStyle: "x" }, { artShape: "star" }, { progressStyle: "x" }, { border: "thick" }]) {
    assert.throws(() => renderCard(presence, { layout: bad }), TypeError);
  }
});

test("show.time hides the elapsed and total clock but keeps the bar", async () => {
  const { renderCard } = await import("../src/card.js");
  const presence = { state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 83000, durationMs: 214000 };
  assert.match(renderCard(presence), /1:23 \/ 3:34/);
  const hidden = renderCard(presence, { show: { time: false } });
  assert.doesNotMatch(hidden, /1:23/);
  assert.match(hidden, /height="4"/);
  assert.throws(() => renderCard(presence, { show: { time: "no" } }), TypeError);
});

test("layout.background transparent leaves the card body unfilled", async () => {
  const { renderCard } = await import("../src/card.js");
  const presence = { state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 1, durationMs: 2 };
  assert.match(renderCard(presence), /<rect x="0.5" y="0.5"[^>]* fill="#0d1117"/);
  const clear = renderCard(presence, { layout: { background: "transparent" } });
  assert.match(clear, /<rect x="0.5" y="0.5"[^>]* fill="none"/);
  assert.throws(() => renderCard(presence, { layout: { background: "blur" } }), TypeError);
});
