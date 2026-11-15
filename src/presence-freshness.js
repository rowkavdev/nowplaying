import { presenceItemKey } from "./presence-identity.js";

const DEFAULT_STALE_AFTER_MS = 60_000;
const observations = new WeakMap();

// Keep progress and identity available to the local stale-session detector
// without attaching private fields to a presence that an output can publish.
export function preservePlaybackObservation(filtered, source) {
  if (filtered.state === "playing" && source.state === "playing") {
    observations.set(filtered, playbackObservation(source));
  }
  return filtered;
}

export function playbackObservation(presence) {
  return observations.get(presence) ?? {
    key: JSON.stringify([presenceItemKey(presence), presence.series, presence.season, presence.episode]),
    positionMs: presence.positionMs,
  };
}

export function presenceAgeMs(presence, now = Date.now()) {
  const observedAt = Date.parse(presence?.updatedAt);
  if (!Number.isFinite(observedAt)) throw new TypeError("presence.updatedAt must be a valid date");
  if (!Number.isFinite(now)) throw new TypeError("now must be a finite timestamp");
  return Math.max(0, now - observedAt);
}

export function presenceFreshness(presence, { now = Date.now(), staleAfterMs = DEFAULT_STALE_AFTER_MS } = {}) {
  if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1_000 || staleAfterMs > 3_600_000) {
    throw new RangeError("staleAfterMs must be an integer from 1000 to 3600000");
  }
  const ageMs = presenceAgeMs(presence, now);
  return Object.freeze({ ageMs, staleAfterMs, fresh: ageMs <= staleAfterMs });
}
