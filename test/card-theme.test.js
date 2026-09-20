import test from "node:test";
import assert from "node:assert/strict";

import { cardThemes, renderCard, resolveCardTheme } from "../src/card.js";

const presence = {
  state: "playing",
  kind: "track",
  title: "Song",
  subtitle: "Artist",
  positionMs: 50,
  durationMs: 100,
};

test("exports immutable built-in themes", () => {
  assert.deepEqual(Object.keys(cardThemes), ["midnight-blue", "paper", "compact"]);
  assert.equal(Object.isFrozen(cardThemes), true);
  assert.equal(Object.isFrozen(cardThemes.paper), true);
});

test("renders the high-contrast paper palette", () => {
  const svg = renderCard(presence, { theme: "paper" });
  assert.match(svg, /fill="#ffffff" stroke="#c7d2df"/);
  assert.match(svg, /fill="#172033"/);
  assert.match(svg, /fill="#0969da"/);
});

test("compact preset hides secondary rows by default", () => {
  const svg = renderCard(presence, { theme: "compact" });
  assert.match(svg, /height="74"/);
  assert.doesNotMatch(svg, />NOW PLAYING<\/text>/);
  assert.doesNotMatch(svg, />Artist<\/text>/);
  assert.doesNotMatch(svg, /height="4"/);
});

test("explicit visibility overrides the compact preset", () => {
  const svg = renderCard(presence, { theme: "compact", show: { state: true } });
  assert.match(svg, />NOW PLAYING<\/text>/);
});

test("accepts normalized custom color tokens", () => {
  const theme = resolveCardTheme("paper", { accent: "#AABBCC" });
  assert.equal(theme.accent, "#aabbcc");
  assert.equal(theme.background, cardThemes.paper.background);
  assert.equal(Object.isFrozen(theme), true);
});

test("rejects unknown themes and unsafe colors", () => {
  assert.throws(
    () => resolveCardTheme("remote"),
    { message: "Unknown card theme: remote" },
  );
  assert.throws(
    () => resolveCardTheme("paper", { accent: "url(javascript:alert(1))" }),
    { message: "card.colors.accent must be a six-digit hex color" },
  );
  assert.throws(
    () => resolveCardTheme("paper", { shadow: "#000000" }),
    { message: "Unknown card color: shadow" },
  );
});
