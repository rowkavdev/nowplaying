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
  assert.doesNotMatch(svg, /<script\b/i);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /A &amp; B/);
});

test("renders a safe idle card", () => {
  const svg = renderCard({ state: "idle", kind: "unknown", title: null, subtitle: null });
  assert.match(svg, /NOT PLAYING/);
  assert.match(svg, /Nothing playing/);
});

test("hides selected fields and reflows the card", () => {
  const compact = renderCard(
    { state: "playing", kind: "track", title: "Song", subtitle: "Artist", positionMs: 50, durationMs: 100 },
    { show: { state: false, subtitle: false, progress: false } },
  );
  assert.match(compact, /height="74"/);
  assert.doesNotMatch(compact, />NOW PLAYING<\/text>/);
  assert.doesNotMatch(compact, />Artist<\/text>/);
  assert.doesNotMatch(compact, /height="4"/);
  assert.match(compact, /<title id="title">NOW PLAYING: Song<\/title>/);
});

test("can hide the media-kind fallback without hiding a real subtitle", () => {
  const fallbackHidden = renderCard(
    { state: "playing", kind: "movie", title: "Film", subtitle: null },
    { show: { mediaType: false } },
  );
  assert.doesNotMatch(fallbackHidden, />Movie<\/text>/);

  const actualSubtitle = renderCard(
    { state: "playing", kind: "movie", title: "Film", subtitle: "Director" },
    { show: { mediaType: false } },
  );
  assert.match(actualSubtitle, />Director<\/text>/);
});

test("rejects unknown or invalid visibility settings", () => {
  assert.throws(
    () => renderCard({ state: "idle", kind: "unknown" }, { show: { provider: true } }),
    { message: "Unknown card visibility setting: provider" },
  );
  assert.throws(
    () => renderCard({ state: "idle", kind: "unknown" }, { show: { progress: "yes" } }),
    { message: "card.show.progress must be a boolean" },
  );
});
