const MEDIA_KINDS = new Set(["track", "episode", "movie", "show", "unknown"]);
const PLAYBACK_STATES = new Set(["playing", "paused", "idle", "offline"]);

export function createPresence(input = {}) {
  const state = input.state ?? "idle";
  const kind = input.kind ?? "unknown";

  if (!PLAYBACK_STATES.has(state)) {
    throw new TypeError(`Unsupported playback state: ${state}`);
  }
  if (!MEDIA_KINDS.has(kind)) {
    throw new TypeError(`Unsupported media kind: ${kind}`);
  }

  const positionMs = nonNegativeNumber(input.positionMs, "positionMs");
  const durationMs = nonNegativeNumber(input.durationMs, "durationMs");
  if (positionMs !== null && durationMs !== null && positionMs > durationMs) {
    throw new RangeError("positionMs cannot exceed durationMs");
  }

  return Object.freeze({
    state,
    kind,
    title: optionalString(input.title, "title"),
    subtitle: optionalString(input.subtitle, "subtitle"),
    artworkUrl: optionalString(input.artworkUrl, "artworkUrl"),
    positionMs,
    durationMs,
    updatedAt: normalizeDate(input.updatedAt),
  });
}

function optionalString(value, name) {
  if (value == null) return null;
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const trimmed = value.trim();
  return trimmed || null;
}

function nonNegativeNumber(value, name) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`);
  }
  return value;
}

function normalizeDate(value) {
  const date = value == null ? new Date() : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("updatedAt must be a valid date");
  return date.toISOString();
}
