import test from "node:test";
import assert from "node:assert/strict";
import { createCardPipeline } from "../src/card-pipeline.js";
import { createPresence } from "../src/presence.js";

test("polls, applies privacy, resolves allowed artwork and renders", async () => {
  const calls = [];
  const artwork = { provider: "plex", itemId: "7", imageId: null, imageTag: null, type: "primary" };
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

test("the pipeline passes an artwork tint on unless the card turns it off (#447)", async () => {
  const presence = { state: "playing", kind: "track", title: "Song", artwork: { provider: "plex", imageId: "/a", type: "thumb" } };
  const seen = [];
  const renderer = (_presence, options) => { seen.push(options); return "<svg/>"; };
  const artworkService = { resolve: async () => ({ dataUri: "data:image/png;base64,AAAA", tint: "#123456" }) };
  const provider = { getPresence: async () => presence };
  await createCardPipeline({ provider, artworkService, providerConfig: {}, renderer })();
  await createCardPipeline({ provider, artworkService, providerConfig: {}, renderer, defaults: () => ({ artworkTint: false }) })();
  await createCardPipeline({ provider, artworkService: { resolve: async () => "data:image/png;base64,AAAA" }, providerConfig: {}, renderer })();
  assert.deepEqual(seen.map((options) => [options.artworkDataUri, options.tint ?? null, "artworkTint" in options]), [
    ["data:image/png;base64,AAAA", "#123456", false],
    ["data:image/png;base64,AAAA", null, false],
    ["data:image/png;base64,AAAA", null, false],
  ]);
});


test("privacy hides the local progress track and timer without changing the saved card preference (#576)", async () => {
  const presence = createPresence({ state: "playing", kind: "track", title: "Song", positionMs: 60_000, durationMs: 120_000 });
  const provider = { getPresence: async () => presence };
  const options = { provider, defaults: () => ({ show: { progress: true } }) };
  const visible = await createCardPipeline(options)();
  const hidden = await createCardPipeline({ ...options, privacy: { hideProgress: true } })();
  assert.match(visible, /width="196" height="4"/);
  assert.match(visible, /1:00 \/ 2:00/);
  assert.doesNotMatch(hidden, /<rect[^>]*height="4"/);
  assert.doesNotMatch(hidden, /1:00 \/ 2:00/);
  assert.match(await createCardPipeline(options)(), /width="196" height="4"/, "switching privacy off restores the saved appearance");
});
