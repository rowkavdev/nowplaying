import { timingSafeEqual } from "node:crypto";
import { defineProvider } from "./provider.js";

// YouTube (#136), app side: the browser extension posts what the active
// YouTube or YouTube Music player is doing, and this turns it into a
// provider. YouTube has no API for "what is this user watching now", so the
// extension is the only source. Only active playback arrives here: never page
// visits, searches, recommendations or history.
//
// - Auth: a pairing token (Bearer) that only the paired extension knows, and
//   the request must come from a browser-extension origin, never a web page.
// - Freshness: the extension resends every ~10 s while playing. A tab that
//   stops reporting for ttlMs is dropped, so a closed browser goes idle.
// - Several tabs: the one that most recently started playing wins. With
//   nothing playing, the most recently paused tab shows as paused.
// - Ads and Shorts never reach the card (the extension skips them; the
//   bridge drops them too).

const EXTENSION_ORIGIN = /^(chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f-]{36})$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STATES = new Set(["playing", "paused", "stopped"]);
const EVENT_KEYS = new Set(["tabId", "videoId", "title", "channel", "thumbnail", "positionMs", "durationMs", "state", "live", "music", "ad", "shorts"]);
const MAX_TABS = 16;

function tokensMatch(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function text(value, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max) throw new TypeError("bad text");
  return value.trim() || null;
}

function ms(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 30 * 24 * 3_600_000) throw new TypeError("bad time");
  return Math.round(value);
}

function thumbnailUrl(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 500) throw new TypeError("bad thumbnail");
  const url = new URL(value);
  // YouTube thumbnails only; nothing that could point at a private address.
  if (url.protocol !== "https:" || !["i.ytimg.com", "i1.ytimg.com", "i2.ytimg.com", "i3.ytimg.com", "i4.ytimg.com", "yt3.ggpht.com", "lh3.googleusercontent.com"].includes(url.hostname)) throw new TypeError("bad thumbnail");
  return url.toString();
}

export function parseYouTubeEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("bad event");
  if (Object.keys(body).some((key) => !EVENT_KEYS.has(key))) throw new TypeError("bad event");
  if (typeof body.tabId !== "string" || !TAB_ID.test(body.tabId)) throw new TypeError("bad tab");
  if (!STATES.has(body.state)) throw new TypeError("bad state");
  for (const key of ["live", "music", "ad", "shorts"]) if (body[key] !== undefined && typeof body[key] !== "boolean") throw new TypeError("bad flag");
  if (body.state === "stopped") return Object.freeze({ tabId: body.tabId, state: "stopped" });
  if (typeof body.videoId !== "string" || !VIDEO_ID.test(body.videoId)) throw new TypeError("bad video");
  const title = text(body.title, 300);
  if (!title) throw new TypeError("bad title");
  const live = body.live === true;
  const durationMs = live ? null : ms(body.durationMs);
  let positionMs = live ? null : ms(body.positionMs);
  if (positionMs !== null && durationMs !== null && positionMs > durationMs) positionMs = durationMs;
  return Object.freeze({
    tabId: body.tabId, state: body.state, videoId: body.videoId, title,
    channel: text(body.channel, 200), thumbnail: thumbnailUrl(body.thumbnail),
    positionMs, durationMs, live, music: body.music === true, skip: body.ad === true || body.shorts === true,
  });
}

export function createYouTubeBridge({ token, ttlMs = 30_000, now = Date.now } = {}) {
  if (typeof token !== "string" || token.length < 32) throw new TypeError("token must be at least 32 characters");
  if (!Number.isInteger(ttlMs) || ttlMs < 5_000) throw new RangeError("ttlMs must be at least 5000");
  const tabs = new Map();

  function prune() {
    for (const [id, tab] of tabs) if (now() - tab.at > ttlMs) tabs.delete(id);
  }

  // Request shape is plain data so the HTTP server can hand it over:
  // { method, headers (lower-case), body (parsed JSON) } -> { status }.
  function receive({ method, headers = {}, body } = {}) {
    if (method !== "POST") return { status: 405 };
    if (!EXTENSION_ORIGIN.test(headers.origin ?? "")) return { status: 403 };
    const auth = /^Bearer (.+)$/.exec(headers.authorization ?? "");
    if (!auth || !tokensMatch(auth[1], token)) return { status: 401 };
    let event;
    try { event = parseYouTubeEvent(body); } catch { return { status: 400 }; }
    prune();
    if (event.state === "stopped" || event.skip) { tabs.delete(event.tabId); return { status: 204 }; }
    const before = tabs.get(event.tabId);
    if (!before && tabs.size >= MAX_TABS) return { status: 429 };
    const startedPlaying = event.state === "playing" && (before?.event.state !== "playing" || before.event.videoId !== event.videoId);
    tabs.set(event.tabId, { event, at: now(), playingSince: startedPlaying ? now() : (before?.playingSince ?? now()) });
    return { status: 204 };
  }

  function current() {
    prune();
    const list = [...tabs.values()];
    const playing = list.filter((tab) => tab.event.state === "playing").sort((a, b) => b.playingSince - a.playingSince);
    if (playing.length) return playing[0].event;
    const paused = list.sort((a, b) => b.at - a.at);
    return paused[0]?.event ?? null;
  }

  const provider = defineProvider({
    id: "youtube",
    mediaKinds: ["track", "episode", "movie"],
    async getPresence() {
      const event = current();
      if (!event) return { state: "idle" };
      return {
        state: event.state,
        // YouTube Music is music. Other videos aren't TV or films, so they
        // stay "unknown" rather than claiming episode metadata.
        kind: event.music ? "track" : "unknown",
        title: event.title,
        subtitle: event.channel,
        artworkUrl: event.thumbnail,
        positionMs: event.positionMs,
        durationMs: event.durationMs,
      };
    },
  });

  return Object.freeze({ receive, provider, tabCount: () => { prune(); return tabs.size; } });
}
