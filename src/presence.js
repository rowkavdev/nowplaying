const MEDIA_KINDS = new Set(["track", "episode", "movie", "show", "unknown"]);
const PLAYBACK_STATES = new Set(["playing", "paused", "idle", "offline"]);
const ARTWORK_PROVIDERS = new Set(["plex", "jellyfin", "navidrome", "emby"]);
const ARTWORK_TYPES = new Set(["primary", "thumb", "cover"]);

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
    artwork: normalizeArtwork(input.artwork),
    artworkUrl: optionalString(input.artworkUrl, "artworkUrl"),
    // Optional TV / film details (#143). Providers that don't know them
    // leave them null; nothing else changes shape.
    series: optionalString(input.series, "series"),
    season: optionalCount(input.season, "season"),
    episode: optionalCount(input.episode, "episode"),
    year: optionalYear(input.year),
    positionMs,
    durationMs,
    updatedAt: normalizeDate(input.updatedAt),
  });
}

function normalizeArtwork(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("artwork must be an object");
  const allowed = new Set(["provider", "itemId", "imageId", "imageTag", "type"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`artwork.${key} is not allowed`);
  }
  if (!ARTWORK_PROVIDERS.has(value.provider)) throw new TypeError("artwork.provider is unsupported");
  if (!ARTWORK_TYPES.has(value.type)) throw new TypeError("artwork.type is unsupported");
  const artwork = {
    provider: value.provider,
    itemId: optionalArtworkId(value.itemId, "artwork.itemId"),
    imageId: optionalArtworkId(value.imageId, "artwork.imageId"),
    imageTag: optionalArtworkId(value.imageTag, "artwork.imageTag"),
    type: value.type,
  };
  if (!artwork.itemId && !artwork.imageId) throw new TypeError("artwork requires itemId or imageId");
  return Object.freeze(artwork);
}

function optionalArtworkId(value, name) {
  if (value == null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw new TypeError(`${name} must be a non-empty string up to 512 characters`);
  }
  return value.trim();
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

function optionalCount(value, name) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 9999) throw new TypeError(`${name} must be a whole number from 0 to 9999`);
  return value;
}

function optionalYear(value) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1800 || value > 2200) throw new TypeError("year must be a whole number from 1800 to 2200");
  return value;
}

function normalizeDate(value) {
  const date = value == null ? new Date() : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("updatedAt must be a valid date");
  return date.toISOString();
}
