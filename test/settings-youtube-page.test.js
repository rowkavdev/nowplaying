import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsPageHandler } from "../src/settings-page-handler.js";

const handler = () => createSettingsPageHandler({ settings: { read: () => ({ discord: {} }), updateDiscord: async () => {}, youtubePairing: async () => ({ token: "t".repeat(43) }), resetYouTubePairing: async () => ({ token: "n".repeat(43) }) }, fallback: async () => ({ status: 299 }) });

test("the page has a hidden YouTube section with show, copy and reset", async () => {
  const h = handler();
  const page = (await h({ url: "/settings" })).body;
  assert.match(page, /<section id="youtube-section" aria-labelledby="h-youtube" hidden>/);
  for (const id of ["youtube-token", "youtube-port", "youtube-show", "youtube-copy", "youtube-reset", "youtube-result"]) assert.match(page, new RegExp(`id="${id}"`), id);
  assert.match(page, /extension's options page/);
  // The token is never in the page itself: only fetched by the script.
  assert.doesNotMatch(page, /t{43}/);
  assert.equal(page.toLowerCase().split("<script").length, 2);
  assert.doesNotMatch(page, /\sstyle=|\son[a-z]+=/i);
});

test("the script reads the code with POST, confirms before reset and hides the section when the bridge is off", async () => {
  const script = (await handler()({ url: "/settings.js" })).body;
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /youtubeFetch\("\/api\/settings\/youtube\/pairing"\)/);
  assert.match(script, /youtubeFetch\("\/api\/settings\/youtube\/pairing\/reset"\)/);
  assert.match(script, /method: "POST"[^\n]*"Content-Type": "application\/json"/);
  assert.match(script, /res\.status === 404\) return null/);
  assert.match(script, /if \(!confirm\("Make a new pairing code\?/);
});
