// Renders the card gallery in docs/card-examples.md. Run after changing
// src/card.js so the committed SVGs always match the shipped renderer:
//   node scripts/render-card-examples.js [outputDir]
// Default output: docs/assets/cards/. Test: test/card-examples.test.js.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderCard } from "../src/card.js";

export const EXAMPLES = [
  {
    file: "music-playing.svg",
    title: "Music, playing (default midnight-blue theme)",
    options: {},
    presence: { kind: "track", state: "playing", title: "Holocene", subtitle: "Bon Iver", positionMs: 154_000, durationMs: 336_000 },
  },
  {
    file: "music-light.svg",
    title: "Music, paper theme",
    options: { theme: "paper" },
    presence: { kind: "track", state: "playing", title: "Holocene", subtitle: "Bon Iver", positionMs: 154_000, durationMs: 336_000 },
  },
  {
    file: "episode-playing.svg",
    title: "TV episode, playing",
    options: {},
    presence: { kind: "episode", state: "playing", title: "The Constant", subtitle: "Lost · S04E05", positionMs: 980_000, durationMs: 2_580_000 },
  },
  {
    file: "movie-playing.svg",
    title: "Movie, playing",
    options: {},
    presence: { kind: "movie", state: "playing", title: "Spirited Away", subtitle: "2001", positionMs: 3_600_000, durationMs: 7_500_000 },
  },
  {
    file: "paused.svg",
    title: "Paused",
    options: {},
    presence: { kind: "track", state: "paused", title: "Holocene", subtitle: "Bon Iver", positionMs: 154_000, durationMs: 336_000 },
  },
  {
    file: "idle.svg",
    title: "Nothing playing",
    options: {},
    presence: { kind: "track", state: "idle", title: "", subtitle: "" },
  },
  {
    file: "compact.svg",
    title: "Compact theme",
    options: { theme: "compact" },
    presence: { kind: "track", state: "playing", title: "Holocene", subtitle: "Bon Iver", positionMs: 154_000, durationMs: 336_000 },
  },
  {
    file: "privacy-redacted.svg",
    title: "Privacy: titles hidden",
    options: {},
    presence: { kind: "track", state: "playing", title: "Private media", subtitle: "", positionMs: 154_000, durationMs: 336_000 },
  },
];

const outDir = process.argv[2] ?? new URL("../docs/assets/cards/", import.meta.url).pathname;

export async function renderExamples(dir) {
  await mkdir(dir, { recursive: true });
  const written = {};
  for (const example of EXAMPLES) {
    const svg = renderCard(example.presence, example.options);
    await writeFile(join(dir, example.file), svg, "utf8");
    written[example.file] = svg;
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const written = await renderExamples(outDir);
  console.log(`wrote ${Object.keys(written).length} cards to ${outDir}`);
}
