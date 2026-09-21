import test from "node:test";
import assert from "node:assert/strict";
import { createCardPipeline } from "../src/card-pipeline.js";
import { createPresence } from "../src/presence.js";

test("polls, applies privacy, resolves allowed artwork and renders", async () => {
  const calls = [];
  const artwork = { provider: "plex", itemId: "7", type: "primary" };
  const provider = { getPresence: async () => createPresence({ state: "playing", kind: "movie", title: "Secret", artwork }) };
  const artworkService = { resolve: async (...args) => { calls.push(args); return "data:image/png;base64,eA=="; } };
  const renderer = (presence, options) => ({ presence, options });
  const resolveCard = createCardPipeline({ provider, privacy: { redactTitles: true, titleReplacement: "Private media" }, artworkService, providerConfig: { baseUrl: "https://plex.test" }, renderer });
  const result = await resolveCard({ theme: "paper", width: 320 });
  assert.equal(result.presence.title, "Private media");
  assert.equal(result.options.artworkDataUri, "data:image/png;base64,eA==");
  assert.deepEqual(calls, [[artwork, { baseUrl: "https://plex.test" }]]);
});

test("privacy can suppress artwork before the artwork service", async () => {
  let called = false;
  const provider = { getPresence: async () => createPresence({ state: "playing", kind: "track", title: "Song", artwork: { provider: "navidrome", itemId: "x", type: "cover" } }) };
  const renderer = (presence, options) => ({ presence, options });
  const result = await createCardPipeline({ provider, privacy: { hideArtwork: true }, artworkService: { resolve: async () => { called = true; } }, renderer })();
  assert.equal(called, false);
  assert.equal(result.options.artworkDataUri, null);
});
