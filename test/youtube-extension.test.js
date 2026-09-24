import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const dir = new URL("../extension/youtube/", import.meta.url);
const context = vm.createContext({ URL });
vm.runInContext(readFileSync(new URL("reader.js", dir), "utf8"), context);
const { readPlayback } = context.NowPlayingReader;

function page({ href = "https://www.youtube.com/watch?v=dQw4w9WgXcQ", paused = false, duration = 212, currentTime = 30, ad = false, live = false, video = true } = {}) {
  const url = new URL(href);
  const nodes = {
    video: video ? { paused, ended: false, duration, currentTime } : null,
    player: { classList: { contains: (name) => ad && name === "ad-showing" } },
    live: live ? { offsetParent: {} } : null,
  };
  const doc = { querySelector: (selector) => selector.includes("video") ? nodes.video : selector === "#movie_player" ? nodes.player : selector === ".ytp-live-badge" ? nodes.live : null };
  const location = { href, pathname: url.pathname, hostname: url.hostname };
  const mediaSession = { metadata: { title: " Never Gonna Give You Up ", artist: "Rick Astley", artwork: [
    { src: "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg", sizes: "120x90" },
    { src: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", sizes: "480x360" },
  ] } };
  return [doc, location, mediaSession];
}

test("reads the active YouTube player (#136)", () => {
  const e = readPlayback(...page());
  assert.equal(e.videoId, "dQw4w9WgXcQ");
  assert.equal(e.title, "Never Gonna Give You Up");
  assert.equal(e.channel, "Rick Astley");
  assert.equal(e.thumbnail, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  assert.equal(e.positionMs, 30_000);
  assert.equal(e.durationMs, 212_000);
  assert.equal(e.state, "playing");
  assert.equal(e.music, false);
  assert.equal(readPlayback(...page({ paused: true })).state, "paused");
  assert.equal(readPlayback(...page({ href: "https://music.youtube.com/watch?v=dQw4w9WgXcQ" })).music, true);
});

test("ads, Shorts, live and non-watch pages", () => {
  assert.equal(readPlayback(...page({ ad: true })).skip, "ad");
  assert.equal(readPlayback(...page({ href: "https://www.youtube.com/shorts/dQw4w9WgXcQ" })).skip, "shorts");
  const live = readPlayback(...page({ live: true }));
  assert.equal(live.live, true);
  assert.equal(live.positionMs, null);
  assert.equal(readPlayback(...page({ duration: Infinity })).live, true);
  assert.equal(readPlayback(...page({ href: "https://www.youtube.com/results?search_query=x" })), null);
  assert.equal(readPlayback(...page({ video: false })), null);
});

test("the manifest asks only for YouTube, 127.0.0.1 and storage", () => {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["http://127.0.0.1/*"]);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://www.youtube.com/*", "https://music.youtube.com/*"]);
});

test("events the extension builds pass the app's bridge schema", async () => {
  const { parseYouTubeEvent } = await import("../src/youtube-bridge.js");
  const e = readPlayback(...page());
  assert.equal(parseYouTubeEvent({ ...e, tabId: "t12" }).title, "Never Gonna Give You Up");
  assert.equal(parseYouTubeEvent({ tabId: "t12", state: "stopped" }).state, "stopped");
});
