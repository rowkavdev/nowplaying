const MAX_DIMENSION = 1024;

export function createArtworkRequest(artwork, providerConfig, { width = 256, height = 256 } = {}) {
  if (artwork === null || typeof artwork !== "object" || Array.isArray(artwork)) {
    throw new TypeError("artwork: expected an opaque artwork reference");
  }
  if (providerConfig === null || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
    throw new TypeError("providerConfig: expected an object");
  }
  for (const [name, value] of Object.entries({ width, height })) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) {
      throw new RangeError(`${name}: must be an integer between 1 and ${MAX_DIMENSION}`);
    }
  }
  const origin = normalizeBaseUrl(providerConfig.baseUrl);
  if (artwork.provider === "plex") return plexRequest(artwork, providerConfig, origin, width, height);
  if (artwork.provider === "jellyfin") return embyFamilyRequest("Jellyfin", artwork, providerConfig, origin, width, height);
  if (artwork.provider === "emby") return embyFamilyRequest("Emby", artwork, providerConfig, origin, width, height);
  if (artwork.provider === "navidrome") return navidromeRequest(artwork, providerConfig, origin, width);
  throw new TypeError(`Unsupported artwork provider: ${String(artwork.provider)}`);
}

function plexRequest(artwork, config, origin, width, height) {
  const token = requiredString(config.token, "Plex token");
  const imagePath = requiredString(artwork.imageId, "Plex artwork imageId");
  if (!imagePath.startsWith("/") || imagePath.includes("..")) {
    throw new TypeError("Plex artwork imageId must be an absolute server path");
  }
  const query = new URLSearchParams({ url: imagePath, width: String(width), height: String(height), minSize: "1", upscale: "0" });
  return Object.freeze({
    url: `${origin}/photo/:/transcode?${query}`,
    headers: Object.freeze({ Accept: "image/jpeg,image/png", "X-Plex-Token": token }),
  });
}

function embyFamilyRequest(name, artwork, config, origin, width, height) {
  const apiKey = requiredString(config.apiKey, `${name} apiKey`);
  const itemId = encodeURIComponent(requiredString(artwork.itemId, `${name} artwork itemId`));
  const query = new URLSearchParams({ maxWidth: String(width), maxHeight: String(height), quality: "90" });
  if (artwork.imageTag) query.set("tag", artwork.imageTag);
  return Object.freeze({
    url: `${origin}/Items/${itemId}/Images/Primary?${query}`,
    headers: Object.freeze({ Accept: "image/jpeg,image/png", "X-Emby-Token": apiKey }),
  });
}

function navidromeRequest(artwork, config, origin, width) {
  const username = requiredString(config.username, "Navidrome username");
  const token = requiredString(config.token, "Navidrome token");
  const salt = requiredString(config.salt, "Navidrome salt");
  const imageId = requiredString(artwork.imageId, "Navidrome artwork imageId");
  const query = new URLSearchParams({ u: username, t: token, s: salt, v: "1.16.1", c: "nowplaying", id: imageId, size: String(width) });
  return Object.freeze({
    url: `${origin}/rest/getCoverArt.view?${query}`,
    headers: Object.freeze({ Accept: "image/jpeg,image/png" }),
  });
}

function normalizeBaseUrl(value) {
  return new URL(requiredString(value, "provider baseUrl")).toString().replace(/\/$/, "");
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is required`);
  return value.trim();
}
