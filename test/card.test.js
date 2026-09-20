import test from "node:test";
import assert from "node:assert/strict";
import { renderCard } from "../src/card.js";

test("renders an accessible playing card and progress", () => {
  const svg = renderCard({ state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 50, durationMs: 100 });
  assert.match(svg, /<svg/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /NOW PLAYING: Song/);
  assert.match(svg, />Song</);
  assert.match(svg, />Artist</);
  assert.match(svg, /width="196" height="4"/);
});

test("escapes untrusted media text", () => {
  const svg = renderCard({ state: "paused", kind: "movie", title: "<script>", subtitle: "A & B" });
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /A &amp; B/);
});

test("renders a safe idle card", () => {
  const svg = renderCard({ state: "idle", kind: "unknown", title: null, subtitle: null });
  assert.match(svg, /NOT PLAYING/);
  assert.match(svg, /Nothing playing/);
});
