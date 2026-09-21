import { createArtworkRequest } from "./artwork.js";
import { artworkCacheKey } from "./artwork-cache.js";
import { artworkDataUri, fetchArtwork } from "./artwork-fetch.js";

export function createArtworkService({ cache, fetchImpl, timeoutMs, maxBytes } = {}) {
  if (!cache || typeof cache.get !== "function" || typeof cache.set !== "function") {
    throw new TypeError("cache: expected an artwork cache");
  }

  return Object.freeze({
    async resolve(artwork, providerConfig, rendition = {}) {
      if (artwork == null) return null;
      const key = artworkCacheKey(artwork, rendition);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const request = createArtworkRequest(artwork, providerConfig, rendition);
      const fetched = await fetchArtwork(request, { fetchImpl, timeoutMs, maxBytes });
      const value = artworkDataUri(fetched);
      cache.set(key, value);
      return value;
    },
  });
}
