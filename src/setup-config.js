import { createProviderIdentity } from "./provider-identity.js";
import { isServerUrl } from "./setup.js";

const PROVIDERS = new Set(["plex", "jellyfin", "navidrome", "emby"]);
const ARTWORK_LOOKUPS = new Set(["off", "musicbrainz"]);

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
    }),
  });
}

export function serializeSetupConfig(input) {
  return `${JSON.stringify(createSetupConfig(input), null, 2)}\n`;
}
