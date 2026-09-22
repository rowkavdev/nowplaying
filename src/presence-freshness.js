const DEFAULT_STALE_AFTER_MS = 60_000;

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
