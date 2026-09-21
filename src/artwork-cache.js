
export function createArtworkCache({ maxEntries = 128, ttlMs = 3_600_000, negativeTtlMs = 60_000, now = Date.now } = {}) {
  for (const [name, value] of Object.entries({ maxEntries, ttlMs, negativeTtlMs })) {
    if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name}: expected a positive integer`);
  }
  if (typeof now !== "function") throw new TypeError("now: expected a function");
  const entries = new Map();

  function get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }

  function set(key, value) {
    if (typeof key !== "string" || !key) throw new TypeError("cache key: expected a non-empty string");
    const expiresAt = now() + (value === null ? negativeTtlMs : ttlMs);
    entries.delete(key);
    entries.set(key, { value, expiresAt });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    return value;
  }

  function clear() { entries.clear(); }

  return Object.freeze({ get, set, clear, get size() { return entries.size; } });
}

export function artworkCacheKey(artwork, { width = 256, height = 256 } = {}) {
  if (artwork === null || typeof artwork !== "object" || Array.isArray(artwork)) throw new TypeError("artwork: expected an object");
  for (const [name, value] of Object.entries({ width, height })) {
    if (!Number.isInteger(value) || value < 1 || value > 1024) throw new RangeError(`${name}: must be between 1 and 1024`);
  }
  const id = artwork.itemId || artwork.imageId;
  if (!artwork.provider || !id || !artwork.type) throw new TypeError("artwork: missing provider, identifier or type");
  return ["san-v1-png", artwork.provider, artwork.type, id, artwork.imageTag || "-", `${width}x${height}`]
    .map((part) => encodeURIComponent(String(part)))
    .join(":");
}
