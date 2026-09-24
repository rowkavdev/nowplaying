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

test("episodes and films read like TV and films, not music (#143)", async () => {
  const { cardText } = await import("../src/card.js");
  const { createPresence } = await import("../src/presence.js");
  const episode = createPresence({ state: "playing", kind: "episode", title: "The Constant", subtitle: "Lost", series: "Lost", season: 4, episode: 5 });
  assert.deepEqual(cardText(episode), { title: "Lost", subtitle: "S04E05 · The Constant" });
  const svg = renderCard(episode);
  assert.match(svg, /<title id="title">NOW PLAYING: Lost<\/title><desc id="desc">S04E05 · The Constant<\/desc>/);
  assert.doesNotMatch(svg, /undefined|null/);
  // Missing numbers or a hidden series fall back cleanly.
  assert.deepEqual(cardText(createPresence({ state: "playing", kind: "episode", title: "Pilot", series: "Show", episode: 1 })), { title: "Show", subtitle: "E01 · Pilot" });
  assert.deepEqual(cardText(createPresence({ state: "playing", kind: "episode", title: "Pilot", series: "Show" })), { title: "Show", subtitle: "Pilot" });
  assert.deepEqual(cardText(createPresence({ state: "paused", kind: "episode", title: "Pilot", subtitle: "Show" })), { title: "Pilot", subtitle: "Show" });
  // Films: year in the title, not repeated underneath.
  const film = createPresence({ state: "playing", kind: "movie", title: "Dune: Part Two", subtitle: "2024", year: 2024 });
  assert.deepEqual(cardText(film), { title: "Dune: Part Two (2024)", subtitle: null });
  assert.match(renderCard(film), /<title id="title">NOW PLAYING: Dune: Part Two \(2024\)<\/title><desc id="desc">Movie<\/desc>/);
  assert.deepEqual(cardText(createPresence({ state: "playing", kind: "movie", title: "Heat" })), { title: "Heat", subtitle: null });
  // Music is untouched.
  assert.deepEqual(cardText(createPresence({ state: "playing", kind: "track", title: "Song", subtitle: "Artist" })), { title: "Song", subtitle: "Artist" });
});

test("truncating long emoji titles never leaves half a surrogate pair", () => {
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  for (let prefix = 0; prefix < 40; prefix++) {
    for (const width of [280, 340, 440]) {
      const svg = renderCard({ state: "playing", kind: "track", title: `${"a".repeat(prefix)}${"😀".repeat(60)}`, subtitle: `${"b".repeat(prefix)}${"🎵".repeat(80)}` }, { width });
      assert.doesNotMatch(svg, lone, `prefix ${prefix}, width ${width}`);
      assert.match(svg, /…/);
    }
  }
});
