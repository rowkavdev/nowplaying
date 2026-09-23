import { createProviderIdentity } from "./provider-identity.js";
import { isServerUrl } from "./setup.js";
import { normalizeHostedUrl } from "./hosted-uploader.js";

const PROVIDERS = new Set(["plex", "jellyfin", "navidrome", "emby"]);
const ARTWORK_LOOKUPS = new Set(["off", "musicbrainz"]);
const TIMESTAMP_MODES = new Set(["elapsed", "remaining", "both", "none"]);

export function createSetupConfig(input = {}) {
  if (!PROVIDERS.has(input.provider)) throw new TypeError("setup config.provider is invalid");
  const identity = createProviderIdentity(input.identity);
  if (input.credential !== undefined || input.token !== undefined || input.apiKey !== undefined) {
    throw new TypeError("setup config cannot contain credentials");
  }
  if (input.credentialStored !== true) throw new TypeError("setup config requires a stored credential");
  if (input.discordEnabled !== undefined && typeof input.discordEnabled !== "boolean") {
    throw new TypeError("setup config.discordEnabled must be a boolean");
  }
  if (input.discordArtworkLookup !== undefined && !ARTWORK_LOOKUPS.has(input.discordArtworkLookup)) {
    throw new TypeError("setup config.discordArtworkLookup must be off or musicbrainz");
  }
  if (input.discordTimestamps !== undefined && !TIMESTAMP_MODES.has(input.discordTimestamps)) {
    throw new TypeError("setup config.discordTimestamps must be elapsed, remaining, both or none");
  }
  if (input.hostedEnabled !== undefined && typeof input.hostedEnabled !== "boolean") {
    throw new TypeError("setup config.hostedEnabled must be a boolean");
  }
  let hostedUrl = null;
  if (input.hostedUrl !== undefined && input.hostedUrl !== null) {
    try { hostedUrl = normalizeHostedUrl(input.hostedUrl); } catch { throw new TypeError("setup config.hostedUrl is invalid"); }
  }
  if (input.serverUrl !== undefined && !isServerUrl(input.serverUrl)) throw new TypeError("setup config.serverUrl is invalid");
  return Object.freeze({
    version: 1,
    provider: input.provider,
    ...(input.serverUrl ? { serverUrl: input.serverUrl } : {}),
    identity,
    credentialRef: Object.freeze({ provider: input.provider, identityId: identity.id }),
    discord: Object.freeze({
      enabled: input.discordEnabled ?? true,
      idleBehavior: input.discordIdleBehavior ?? "clear",
      // Configs written before this field existed stay off: nothing new is
      // sent until the user runs setup again or turns it on.
      artworkLookup: input.discordArtworkLookup ?? "off",
      // Discord timer (set from the settings page): elapsed, remaining, both
      // or none. Left out means "both", so setup's own output is unchanged.
      ...(input.discordTimestamps !== undefined ? { timestamps: input.discordTimestamps } : {}),
    }),
    // Hosted card upload (#140) is off unless the user turns it on.
    ...(input.hostedEnabled !== undefined || hostedUrl ? {
      hosted: Object.freeze({ enabled: input.hostedEnabled ?? false, ...(hostedUrl ? { url: hostedUrl } : {}) }),
    } : {}),
  });
}

export function serializeSetupConfig(input) {
  return `${JSON.stringify(createSetupConfig(input), null, 2)}\n`;
}
