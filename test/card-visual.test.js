import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { renderCard } from "../src/card.js";

// Visual regression fixtures for the card layout presets (#94). Each preset's
// SVG is committed under test/fixtures/cards. After an intended renderer
// change, refresh them with:
//   UPDATE_CARD_FIXTURES=1 node --test test/card-visual.test.js
// then look at the changed SVGs before committing.
const ART = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPo6p8BAANYAbKMazHIAAAAAElFTkSuQmCC"; // 1x1 grey
const MUSIC = { state: "playing", kind: "track", title: "Blue Monday", subtitle: "New Order", positionMs: 83_000, durationMs: 448_000 };
const EPISODE = { state: "paused", kind: "episode", title: "The Constant", subtitle: "Lost · S4 E5", positionMs: 1_200_000, durationMs: 2_580_000 };
const HEBREW = { state: "playing", kind: "track", title: "שיר לדוגמה", subtitle: "אמן לדוגמה", positionMs: 60_000, durationMs: 200_000 };
const IDLE = { state: "idle" };
// TV and films with full metadata (#143), and an episode whose series is
// hidden by the privacy settings (falls back to the plain text).
const TV = { state: "playing", kind: "episode", title: "The Constant", subtitle: "Lost", series: "Lost", season: 4, episode: 5, positionMs: 1_200_000, durationMs: 2_580_000 };
const TV_HIDDEN = { ...TV, series: null, season: null, episode: null, subtitle: null };
const FILM = { state: "playing", kind: "movie", title: "Dune: Part Two", subtitle: "2024", year: 2024, positionMs: 3_000_000, durationMs: 9_960_000 };

export const PRESETS = [
  { file: "default.svg", presence: MUSIC, options: { artworkDataUri: ART } },
  { file: "default-no-artwork.svg", presence: MUSIC, options: {} },
  { file: "paper-artwork-right.svg", presence: MUSIC, options: { theme: "paper", artworkDataUri: ART, layout: { artworkPosition: "right", artworkWidth: 120, artworkHeight: 120 } } },
  { file: "compact.svg", presence: MUSIC, options: { theme: "compact", width: 320 } },
  { file: "centred-reordered.svg", presence: MUSIC, options: { layout: { fieldOrder: ["title", "subtitle", "state"], textAlign: "middle" } } },
  { file: "end-aligned-tight.svg", presence: EPISODE, options: { width: 360, layout: { textAlign: "end", padding: 12, radius: 0, titleSize: 16, subtitleSize: 12 } } },
  { file: "progress-under-text.svg", presence: MUSIC, options: { artworkDataUri: ART, layout: { progressPosition: "text", progressHeight: 6 } } },
  { file: "progress-full-width.svg", presence: EPISODE, options: { artworkDataUri: ART, layout: { progressWidth: "full" } } },
  { file: "rtl-auto.svg", presence: HEBREW, options: { artworkDataUri: ART, layout: { direction: "auto" } } },
  { file: "idle.svg", presence: IDLE, options: { width: 500 } },
  { file: "tv-episode.svg", presence: TV, options: { artworkDataUri: ART } },
  { file: "tv-episode-paper-narrow.svg", presence: TV, options: { theme: "paper", width: 280 } },
  { file: "tv-episode-series-hidden.svg", presence: TV_HIDDEN, options: {} },
  { file: "film.svg", presence: FILM, options: { artworkDataUri: ART, layout: { artworkPosition: "right" } } },
  { file: "film-compact.svg", presence: FILM, options: { theme: "compact", width: 320 } },
];

const fixture = (file) => new URL(`./fixtures/cards/${file}`, import.meta.url);

test("card presets match their committed SVG fixtures", async () => {
  for (const { file, presence, options } of PRESETS) {
    const svg = renderCard(presence, options);
    if (process.env.UPDATE_CARD_FIXTURES === "1") await writeFile(fixture(file), svg);
    const committed = await readFile(fixture(file), "utf8").catch(() => null);
    assert.ok(committed !== null, `${file} is missing - run: UPDATE_CARD_FIXTURES=1 node --test test/card-visual.test.js`);
    assert.equal(svg, committed, `${file} changed - if intended, run: UPDATE_CARD_FIXTURES=1 node --test test/card-visual.test.js`);
  }
});
