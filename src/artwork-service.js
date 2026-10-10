import { createArtworkRequest } from "./artwork.js";
import { artworkCacheKey } from "./artwork-cache.js";
import { artworkDataUri, fetchArtwork } from "./artwork-fetch.js";

export function createArtworkService({ cache, sanitizer, fetchImpl, timeoutMs, maxBytes } = {}) {
  if (!cache || typeof cache.get !== "function" || typeof cache.set !== "function") throw new TypeError("cache: expected an artwork cache");
  if (sanitizer !== undefined && typeof sanitizer !== "function") throw new TypeError("sanitizer: expected a function");
  let generation = 0;

  return Object.freeze({
    async resolve(artwork, providerConfig, rendition = {}) {
      if (artwork == null) return null;
      const owner = generation;
      const key = artworkCacheKey(artwork, rendition);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const request = createArtworkRequest(artwork, providerConfig, rendition);
      const fetched = await fetchArtwork(request, { fetchImpl, timeoutMs, maxBytes });
      const cleaned = fetched === null ? null : sanitizer ? await sanitizer(fetched, rendition) : fetched;
      const sanitized = cleaned === null ? null : sanitizer ? validateSanitized(cleaned) : cleaned;
      const value = artworkDataUri(sanitized);
      if (owner === generation) cache.set(key, value);
      return value;
    },
    // Refreshing Discord artwork must also forget the card's cached cover or
    // missing-image result. A pre-refresh fetch cannot refill the new cache.
    clear() { generation += 1; cache.clear?.(); },
  });
}

function validateSanitized(value) {
  if (!value || !["image/jpeg", "image/png", "image/webp"].includes(value.contentType) || !(value.bytes instanceof Uint8Array)) throw new TypeError("sanitizer: expected validated raster output");
  if (!Number.isInteger(value.width) || value.width < 1 || !Number.isInteger(value.height) || value.height < 1) throw new TypeError("sanitizer: expected positive output dimensions");
  return Object.freeze({ contentType: value.contentType, bytes: value.bytes, width: value.width, height: value.height });
}
