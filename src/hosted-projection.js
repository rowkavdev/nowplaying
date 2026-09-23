import { applyPrivacy } from "./privacy.js";

// Builds the one payload the desktop app may push to the hosted card service
// (#140). Everything is opt-in: a field only leaves the PC when the privacy
// policy and the card's own `show` settings both allow it. Artwork, users,
// servers and provider IDs are never sent; the v1 ingest schema has no place
// for them.

export const HOSTED_SCHEMA_VERSION = 1;
export const HOSTED_TEXT_LIMIT = 200;

const HOSTED_KINDS = new Set(["track", "episode", "movie", "show", "unknown"]);

function clip(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // The service counts UTF-16 units; cut on a code point so emoji never split.
  let out = "";
  for (const char of trimmed) {
    if (out.length + char.length > HOSTED_TEXT_LIMIT) break;
    out += char;
  }
  return out;
}

function wholeMs(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

export function projectHostedState(presence, { privacy = {}, show = {} } = {}, { seq, now = Date.now() } = {}) {
  if (!Number.isSafeInteger(seq) || seq < 0) throw new TypeError("seq must be a non-negative safe integer");
  if (!Number.isSafeInteger(now)) throw new TypeError("now must be a safe integer timestamp");
  const filtered = applyPrivacy(presence, privacy);
  const state = filtered.state === "playing" || filtered.state === "paused" ? filtered.state : "idle";
  const payload = { v: HOSTED_SCHEMA_VERSION, seq, observedAt: now, state };
  if (state === "idle") return payload;

  payload.kind = show.mediaType === false || !HOSTED_KINDS.has(filtered.kind) ? "unknown" : filtered.kind;
  const title = clip(filtered.title);
  if (title) payload.title = title;
  if (show.subtitle !== false) {
    const subtitle = clip(filtered.subtitle);
    if (subtitle) payload.subtitle = subtitle;
  }
  if (show.progress !== false) {
    const durationMs = wholeMs(filtered.durationMs);
    const positionMs = wholeMs(filtered.positionMs);
    if (durationMs !== null) payload.durationMs = durationMs;
    if (positionMs !== null) payload.positionMs = durationMs !== null ? Math.min(positionMs, durationMs) : positionMs;
  }
  return payload;
}
