import test from "node:test";
import assert from "node:assert/strict";
import { createYouTubeBridge, createYouTubeBridgeHandler, loadYouTubePairingToken, parseYouTubeEvent } from "../src/youtube-bridge.js";

const token = "t".repeat(40);
const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const headers = { origin, authorization: `Bearer ${token}` };
const video = (extra = {}) => ({ tabId: "tab1", videoId: "dQw4w9WgXcQ", title: "A video", channel: "A channel", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", positionMs: 5000, durationMs: 200000, state: "playing", ...extra });

function bridge() {
  let t = 1_000;
  const b = createYouTubeBridge({ token, now: () => t });
  return { b, tick: (ms) => { t += ms; } };
}

test("a paired extension's playback shows up (#136)", async () => {
  const { b } = bridge();
  assert.equal((await b.provider.getPresence()).state, "idle");
  assert.equal(b.receive({ method: "POST", headers, body: video() }).status, 204);
  const p = await b.provider.getPresence();
  assert.equal(p.state, "playing");
  assert.equal(p.kind, "unknown");
  assert.equal(p.title, "A video");
  assert.equal(p.subtitle, "A channel");
  assert.equal(p.artworkUrl, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  assert.equal(p.positionMs, 5000);
  b.receive({ method: "POST", headers, body: video({ music: true }) });
  assert.equal((await b.provider.getPresence()).kind, "track");
});

test("rejects web pages, wrong tokens and bad payloads", () => {
  const { b } = bridge();
  assert.equal(b.receive({ method: "POST", headers: { ...headers, origin: "https://www.youtube.com" }, body: video() }).status, 403);
  assert.equal(b.receive({ method: "POST", headers: { authorization: headers.authorization }, body: video() }).status, 403);
  assert.equal(b.receive({ method: "POST", headers: { ...headers, authorization: "Bearer nope" }, body: video() }).status, 401);
  assert.equal(b.receive({ method: "GET", headers, body: video() }).status, 405);
  for (const body of [null, [], video({ videoId: "short" }), video({ title: "" }), video({ state: "buffering" }), video({ extra: 1 }),
    video({ thumbnail: "http://i.ytimg.com/x.jpg" }), video({ thumbnail: "https://192.168.1.2/x.jpg" }), video({ tabId: "../x" }), video({ positionMs: -1 }), video({ live: "yes" })]) {
    assert.equal(b.receive({ method: "POST", headers, body }).status, 400, JSON.stringify(body));
  }
  assert.equal(b.tabCount(), 0);
  assert.throws(() => createYouTubeBridge({ token: "short" }), /token/);
});

test("ads, Shorts and stop clear the tab; silence goes idle after the TTL", async () => {
  const { b, tick } = bridge();
  b.receive({ method: "POST", headers, body: video() });
  b.receive({ method: "POST", headers, body: video({ ad: true }) });
  assert.equal((await b.provider.getPresence()).state, "idle");
  b.receive({ method: "POST", headers, body: video() });
  b.receive({ method: "POST", headers, body: video({ shorts: true }) });
  assert.equal((await b.provider.getPresence()).state, "idle");
  b.receive({ method: "POST", headers, body: video() });
  b.receive({ method: "POST", headers, body: { tabId: "tab1", state: "stopped" } });
  assert.equal((await b.provider.getPresence()).state, "idle");
  b.receive({ method: "POST", headers, body: video() });
  tick(29_999);
  assert.equal((await b.provider.getPresence()).state, "playing");
  tick(2);
  assert.equal((await b.provider.getPresence()).state, "idle");
});

test("the most recently started tab wins; paused shows when nothing plays", async () => {
  const { b, tick } = bridge();
  b.receive({ method: "POST", headers, body: video({ tabId: "a", title: "First" }) });
  tick(1000);
  b.receive({ method: "POST", headers, body: video({ tabId: "b", title: "Second" }) });
  tick(1000);
  // Heartbeat from the older tab doesn't steal it back.
  b.receive({ method: "POST", headers, body: video({ tabId: "a", title: "First" }) });
  assert.equal((await b.provider.getPresence()).title, "Second");
  b.receive({ method: "POST", headers, body: video({ tabId: "b", title: "Second", state: "paused" }) });
  assert.equal((await b.provider.getPresence()).title, "First");
  b.receive({ method: "POST", headers, body: video({ tabId: "a", title: "First", state: "paused" }) });
  const p = await b.provider.getPresence();
  assert.equal(p.state, "paused");
  assert.equal(p.title, "First");
});

test("live streams have no position or duration", () => {
  const e = parseYouTubeEvent(video({ live: true }));
  assert.equal(e.positionMs, null);
  assert.equal(e.durationMs, null);
});

test("pairing token is made once and reused (#136)", async () => {
  const saved = {};
  const store = { read: async (ref) => saved[`${ref.provider}:${ref.identityId}`] ?? null, save: async (ref, secret) => { saved[`${ref.provider}:${ref.identityId}`] = secret; } };
  const first = await loadYouTubePairingToken(store);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await loadYouTubePairingToken(store), first);
});

test("bridge route parses JSON and passes other paths on (#136)", async () => {
  const bridge = createYouTubeBridge({ token });
  const handle = createYouTubeBridgeHandler({ bridge, fallback: async () => ({ status: 299 }) });
  assert.equal((await handle({ method: "GET", url: "/card.svg" })).status, 299);
  assert.equal((await handle({ method: "POST", url: "/bridge/youtube", headers, body: "{not json" })).status, 400);
  assert.equal((await handle({ method: "GET", url: "/bridge/youtube", headers })).status, 405);
  assert.equal((await handle({ method: "POST", url: "/bridge/youtube", headers, body: JSON.stringify(video()) })).status, 204);
  assert.equal((await bridge.provider.getPresence()).title, "A video");
});

test("Discord shows a YouTube video as Watching and YouTube Music as Listening (#136)", async () => {
  const { youtubeForDiscord } = await import("../src/app-config.js");
  const { formatDiscordActivity } = await import("../src/discord.js");
  const { createPresence } = await import("../src/presence.js");
  const bridge = createYouTubeBridge({ token });
  const discord = youtubeForDiscord(bridge.provider);
  assert.equal((await discord.getPresence()).state, "idle");
  bridge.receive({ method: "POST", headers, body: video() });
  const watching = createPresence(await discord.getPresence());
  assert.equal(formatDiscordActivity(watching).type, "watching");
  bridge.receive({ method: "POST", headers, body: video({ tabId: "tab2", music: true, title: "A song" }) });
  const listening = createPresence(await discord.getPresence());
  assert.equal(listening.title, "A song");
  assert.equal(formatDiscordActivity(listening).type, "listening");
  bridge.receive({ method: "POST", headers, body: { tabId: "tab3", videoId: "abcdefghijk", title: "Short", state: "playing", shorts: true } });
  assert.equal((await discord.getPresence()).title, "A song");
});
