import { createArtworkRequest } from "./artwork.js";
import { artworkCacheKey } from "./artwork-cache.js";
import { artworkDataUri, fetchArtwork } from "./artwork-fetch.js";

export function createArtworkService({ cache, sanitizer, fetchImpl, timeoutMs, maxBytes } = {}) {
  if (!cache || typeof cache.get !== "function" || typeof cache.set !== "function") throw new TypeError("cache: expected an artwork cache");
  if (sanitizer !== undefined && typeof sanitizer !== "function") throw new TypeError("sanitizer: expected a function");

  return Object.freeze({
    async resolve(artwork, providerConfig, rendition = {}) {
      if (artwork == null) return null;
      const key = artworkCacheKey(artwork, rendition);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const request = createArtworkRequest(artwork, providerConfig, rendition);
      const fetched = await fetchArtwork(request, { fetchImpl, timeoutMs, maxBytes });
      const sanitized = fetched === null ? null : sanitizer ? validateSanitized(await sanitizer(fetched, rendition)) : fetched;
      const value = artworkDataUri(sanitized);
      cache.set(key, value);
      return value;
    },
  });
}

function validateSanitized(value) {
  if (!value || !["image/jpeg", "image/png", "image/webp"].includes(value.contentType) || !(value.bytes instanceof Uint8Array)) throw new TypeError("sanitizer: expected validated raster output");
  if (!Number.isInteger(value.width) || value.width < 1 || !Number.isInteger(value.height) || value.height < 1) throw new TypeError("sanitizer: expected positive output dimensions");
  return Object.freeze({ contentType: value.contentType, bytes: value.bytes, width: value.width, height: value.height });
}
