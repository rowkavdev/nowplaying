import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { createMusicBrainzLookup } from "./musicbrainz-lookup.js";

const ASSET_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const SECRET_PARAM = /(^|[_-])(token|key|apikey|api_key|auth|sig|signature|secret|password|pass|session|s|t|u)$/i;
const LOCAL_SUFFIXES = [".local", ".lan", ".home", ".internal", ".localdomain", ".home.arpa", ".corp"];

// Shown when no real cover can be used. The NowPlaying Discord app has no
// uploaded art assets, so an asset key like "media" renders as a "?" in
// Discord. A public HTTPS image always works (#268).
export const FALLBACK_ARTWORK_URL = "https://raw.githubusercontent.com/rowkavdev/nowplaying/main/assets/discord-fallback.png";

// An uploaded Discord asset key, or a public HTTPS image URL.
export function isDiscordImage(value) {
  return typeof value === "string" && (ASSET_PATTERN.test(value) || classifyArtworkUrl(value).ok);
}

export const artworkFailures = Object.freeze(["invalid", "not_https", "credentials", "private_host", "secret_query", "too_long", "unsupported_format"]);
// Animated or video artwork (Apple Music style motion covers, .m3u8 HLS streams)
// shows as a blank image in Discord, so it falls through to the next source.
const VIDEO_EXTENSION = /\.(m3u8|mp4|m4v|webm|mov|mkv)$/i;

function ipv4Private(host) {
  const parts = host.split(".").map(Number);
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function ipv6Private(host) {
  const h = host.toLowerCase();
  if (h === "::" || h === "::1") return true;
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  if (h.startsWith("::ffff:")) return true;
  return /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("ff");
}

export function isPrivateHost(hostname) {
  const host = String(hostname).replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) return true;
  const family = isIP(host);
  if (family === 4) return ipv4Private(host);
  if (family === 6) return ipv6Private(host);
  if (host === "localhost" || host.endsWith(".localhost") || !host.includes(".")) return true;
  return LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function classifyArtworkUrl(value) {
  if (typeof value !== "string" || !value) return { ok: false, failure: "invalid" };
  if (value.length > 256) return { ok: false, failure: "too_long" };
  let url;
  try { url = new URL(value); } catch { return { ok: false, failure: "invalid" }; }
  if (url.protocol !== "https:") return { ok: false, failure: "not_https" };
  if (url.username || url.password) return { ok: false, failure: "credentials" };
  if (isPrivateHost(url.hostname)) return { ok: false, failure: "private_host" };
  for (const name of url.searchParams.keys()) {
    if (SECRET_PARAM.test(name)) return { ok: false, failure: "secret_query" };
  }
  if (VIDEO_EXTENSION.test(url.pathname)) return { ok: false, failure: "unsupported_format" };
  url.hash = "";
  return { ok: true, url: url.href };
}

function validateOptions({ publicProxyBase, metadataLookup, fallbackAsset, ttlMs, negativeTtlMs, maxEntries }) {
  if (publicProxyBase !== undefined && publicProxyBase !== "") {
    const checked = classifyArtworkUrl(publicProxyBase);
    if (!checked.ok || new URL(publicProxyBase).search) throw new TypeError("discord artwork: publicProxyBase must be a public HTTPS URL without a query");
  }
  if (typeof metadataLookup !== "boolean") throw new TypeError("discord artwork: metadataLookup must be a boolean");
  if (!isDiscordImage(fallbackAsset)) throw new TypeError("discord artwork: fallbackAsset must be an asset key or a public HTTPS image URL");
  for (const [name, value, min, max] of [["ttlMs", ttlMs, 1_000, 86_400_000], ["negativeTtlMs", negativeTtlMs, 1_000, 86_400_000], ["maxEntries", maxEntries, 1, 10_000]]) {
    if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`discord artwork: ${name} is out of range`);
  }
}

export function createDiscordArtworkResolver({
  publicProxyBase = "",
  metadataLookup = false,
  lookup,
  fallbackAsset = FALLBACK_ARTWORK_URL,
  ttlMs = 6 * 60 * 60_000,
  negativeTtlMs = 10 * 60_000,
  maxEntries = 500,
  now = () => Date.now(),
} = {}) {
  validateOptions({ publicProxyBase, metadataLookup, fallbackAsset, ttlMs, negativeTtlMs, maxEntries });
  if (metadataLookup && typeof lookup !== "function") throw new TypeError("discord artwork: lookup is required when metadataLookup is enabled");
  const cache = new Map();
  let last = Object.freeze({ strategy: "none", failure: null });

  function remember(key, entry, ttl) {
    cache.delete(key);
    cache.set(key, { ...entry, expiresAt: now() + ttl });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  function finish(result) {
    last = Object.freeze({ strategy: result.strategy, failure: result.failure ?? null });
    return Object.freeze({ ...result, failure: result.failure ?? null });
  }

  async function resolve(presence = {}) {
    const ref = presence.artwork ? JSON.stringify([presence.artwork.provider, presence.artwork.itemId, presence.artwork.imageId, presence.artwork.imageTag]) : "";
    // The media kind is part of the key so a film, an episode and a song that
    // share a title and subtitle never reuse each other's artwork (#154).
    const key = createHash("sha256").update(JSON.stringify([presence.kind ?? "", ref, presence.artworkUrl ?? "", presence.title ?? "", presence.artist ?? presence.subtitle ?? ""])).digest("hex");
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      cache.delete(key); cache.set(key, cached);
      return finish({ image: cached.image, strategy: cached.strategy, failure: cached.failure, cached: true });
    }
    if (cached) cache.delete(key);

    let failure = null;
    if (presence.artworkUrl) {
      const checked = classifyArtworkUrl(presence.artworkUrl);
      if (checked.ok) {
        const entry = { image: checked.url, strategy: "provider", failure: null };
        remember(key, entry, ttlMs);
        return finish({ ...entry, cached: false });
      }
      failure = checked.failure;
    }
    if (publicProxyBase && ref) {
      const opaque = createHash("sha256").update(ref).digest("hex").slice(0, 32);
      const entry = { image: `${publicProxyBase.replace(/\/+$/, "")}/${opaque}`, strategy: "proxy", failure };
      remember(key, entry, ttlMs);
      return finish({ ...entry, cached: false });
    }
    // MusicBrainz only knows music: a film or episode title would match a
    // random song and show a confidently wrong cover, so only tracks look up.
    const music = presence.kind === undefined || presence.kind === "track";
    if (metadataLookup && music && presence.title) {
      try {
        const found = await lookup(Object.freeze({ title: String(presence.title), artist: String(presence.artist ?? presence.subtitle ?? "") }));
        const checked = classifyArtworkUrl(found);
        if (checked.ok) {
          const entry = { image: checked.url, strategy: "lookup", failure };
          remember(key, entry, ttlMs);
          return finish({ ...entry, cached: false });
        }
        failure = failure ?? `lookup_${found ? checked.failure : "miss"}`;
      } catch {
        failure = failure ?? "lookup_error";
      }
    }
    const entry = { image: fallbackAsset, strategy: "fallback", failure };
    remember(key, entry, negativeTtlMs);
    return finish({ ...entry, cached: false });
  }

  // Manual refresh (#154): drop every cached cover and miss so the next
  // update looks artwork up again. Returns how many entries were dropped.
  function clear() {
    const dropped = cache.size;
    cache.clear();
    last = Object.freeze({ strategy: "none", failure: null });
    return dropped;
  }

  return Object.freeze({ resolve, clear, status: () => last, size: () => cache.size });
}


export function artworkResolverOptions(discordSettings = {}, { createLookup = createMusicBrainzLookup } = {}) {
  const proxy = typeof discordSettings.artworkProxy === "string" ? discordSettings.artworkProxy : "";
  if (discordSettings.artworkLookup !== "musicbrainz") return Object.freeze({ publicProxyBase: proxy, metadataLookup: false });
  return Object.freeze({ publicProxyBase: proxy, metadataLookup: true, lookup: createLookup() });
}
