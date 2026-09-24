import { createProviderIdentity } from "./provider-identity.js";
import { isServerUrl } from "./setup.js";
import { normalizeHostedUrl } from "./hosted-uploader.js";

const PROVIDERS = new Set(["plex", "jellyfin", "navidrome", "emby"]);
const ARTWORK_LOOKUPS = new Set(["off", "musicbrainz"]);
const TIMESTAMP_MODES = new Set(["elapsed", "remaining", "both", "none"]);
const PRIVACY_FLAGS = ["redactTitles", "hideArtwork", "hideProgress"];
const PRIVACY_KINDS = new Set(["movie", "episode", "track"]);

// Privacy (set from the settings page, #253). Left out means nothing hidden.
function normalizePrivacy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("setup config.privacy must be an object");
  const privacy = {};
  for (const key of Object.keys(value)) {
    if (PRIVACY_FLAGS.includes(key)) {
      if (typeof value[key] !== "boolean") throw new TypeError(`setup config.privacy.${key} must be a boolean`);
      privacy[key] = value[key];
    } else if (key === "suppressMediaKinds") {
      const kinds = value[key];
      if (!Array.isArray(kinds) || kinds.some((kind) => !PRIVACY_KINDS.has(kind))) throw new TypeError("setup config.privacy.suppressMediaKinds must list movie, episode or track");
      privacy[key] = Object.freeze([...new Set(kinds)].sort());
    } else {
      throw new TypeError(`setup config.privacy.${key} is not a setting`);
    }
  }
  return Object.freeze(privacy);
}

// Card appearance (#94, set from the settings page). Left out means the
// renderer defaults, so older configs draw the same card as before.
const CARD_THEMES = new Set(["midnight-blue", "paper", "compact"]);
const CARD_NUMBERS = Object.freeze({ width: [280, 800], padding: [12, 48], radius: [0, 24], progressHeight: [2, 12] });
function normalizeCard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("setup config.card must be an object");
  const card = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (key === "theme") {
      if (!CARD_THEMES.has(item)) throw new TypeError("setup config.card.theme must be midnight-blue, paper or compact");
    } else if (key === "showProgress") {
      if (typeof item !== "boolean") throw new TypeError("setup config.card.showProgress must be a boolean");
    } else if (Object.hasOwn(CARD_NUMBERS, key)) {
      const [min, max] = CARD_NUMBERS[key];
      if (!Number.isInteger(item) || item < min || item > max) throw new TypeError(`setup config.card.${key} must be a whole number from ${min} to ${max}`);
    } else {
      throw new TypeError(`setup config.card.${key} is not a setting`);
    }
    card[key] = item;
  }
  return Object.freeze(card);
}

// Renderer options for a saved card section: query options on /card.svg
// still win over these.
export function cardRenderOptions(card) {
  if (!card) return Object.freeze({});
  const layout = {};
  for (const key of ["padding", "radius", "progressHeight"]) if (card[key] !== undefined) layout[key] = card[key];
  return Object.freeze({
    ...(card.theme ? { theme: card.theme } : {}),
    ...(card.width !== undefined ? { width: card.width } : {}),
    ...(Object.keys(layout).length ? { layout } : {}),
    ...(card.showProgress !== undefined ? { show: { progress: card.showProgress } } : {}),
  });
}

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
  const privacy = input.privacy === undefined ? null : normalizePrivacy(input.privacy);
  const card = input.card === undefined ? null : normalizeCard(input.card);
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
    ...(privacy ? { privacy } : {}),
    ...(card && Object.keys(card).length ? { card } : {}),
  });
}

export function serializeSetupConfig(input) {
  return `${JSON.stringify(createSetupConfig(input), null, 2)}\n`;
}
