import test from "node:test";
import assert from "node:assert/strict";

import { renderCard } from "../src/card.js";

const presence = { state: "playing", kind: "movie", title: "Arrival", subtitle: "2016", positionMs: 50, durationMs: 100 };
const image = "data:image/png;base64,iVBORw0KGgo=";

test("embeds validated raster artwork and reflows content", () => {
  const svg = renderCard(presence, { artworkDataUri: image });
  assert.match(svg, /height="148"/);
  assert.match(svg, /<image href="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(svg, /x="116" y="64"/);
  assert.match(svg, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(svg, /clip-path="url\(#art\)"/);
});

test("falls back to the text layout when artwork is absent or hidden", () => {
  const plain = renderCard(presence);
  assert.doesNotMatch(plain, /<image/);
  assert.match(plain, /x="24" y="64"/);
  const hidden = renderCard(presence, { artworkDataUri: image, show: { artwork: false } });
  assert.doesNotMatch(hidden, /<image/);
  assert.match(hidden, /x="24" y="64"/);
});

test("compact theme hides artwork unless explicitly enabled", () => {
  assert.doesNotMatch(renderCard(presence, { theme: "compact", artworkDataUri: image }), /<image/);
  assert.match(renderCard(presence, { theme: "compact", artworkDataUri: image, show: { artwork: true } }), /<image/);
});

test("rejects external and active image sources", () => {
  assert.throws(
    () => renderCard(presence, { artworkDataUri: "https://private.example/art?token=secret" }),
    { message: "artworkDataUri must be a validated raster data URI" },
  );
  assert.throws(
    () => renderCard(presence, { artworkDataUri: "data:image/svg+xml;base64,PHN2Zz4=" }),
    { message: "artworkDataUri must be a validated raster data URI" },
  );
});
