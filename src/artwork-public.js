import { createArtworkCache } from "./artwork-cache.js";
import { fetchArtwork, artworkDataUri } from "./artwork-fetch.js";
// Public provider covers need no credentials. Restrict fetches to provider
// CDNs; a playback URL can never turn the card into an arbitrary URL fetcher.
const HOSTS = new Set(["i.scdn.co", "mosaic.scdn.co", "image-cdn-ak.spotifycdn.com", "image-cdn-fa.spotifycdn.com", "i.ytimg.com"]);
export function createPublicCardArtwork({ fetchImpl = fetch } = {}) {
  const cache = createArtworkCache({ maxEntries: 32 });
  let sanitizer;
  let generation = 0;
  return {
    clear() { generation++; cache.clear(); },
    async resolve(url, rendition = { width: 256, height: 256 }) {
      let parsed;
      try { parsed = new URL(url); } catch { return null; }
      if (parsed.protocol !== "https:" || !HOSTS.has(parsed.hostname) || parsed.port || parsed.username || parsed.password) return null;
      const key = `${parsed.href}:${rendition.width}x${rendition.height}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const owner = generation;
      try {
        sanitizer ??= import("./artwork-sanitizer-runtime.js").then(m => m.createDefaultArtworkSanitizer());
        const raw = await fetchArtwork({ url: parsed.href, headers: { Accept: "image/jpeg,image/png,image/webp" } }, { fetchImpl, timeoutMs: 3000 });
        const value = raw ? artworkDataUri(await (await sanitizer)(raw, rendition)) : null;
        if (owner === generation) cache.set(key, value);
        return value;
      } catch { if (owner === generation) cache.set(key, null); return null; }
    },
  };
}
