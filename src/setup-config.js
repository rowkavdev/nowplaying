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
const CARD_NUMBERS = Object.freeze({ width: [280, 800], padding: [12, 48], radius: [0, 24], progressHeight: [2, 12], artworkWidth: [48, 160], artworkHeight: [48, 180] });
const ARTWORK_POSITIONS = new Set(["left", "right"]);
const TEXT_ALIGNS = new Set(["start", "middle", "end"]);
const CARD_FIELDS = Object.freeze(["state", "title", "subtitle"]);
const LAYOUT_KEYS = Object.freeze(["padding", "radius", "progressHeight", "artworkPosition", "artworkWidth", "artworkHeight", "fieldOrder", "textAlign"]);
export function normalizeCard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("setup config.card must be an object");
  const card = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (key === "theme") {
      if (!CARD_THEMES.has(item)) throw new TypeError("setup config.card.theme must be midnight-blue, paper or compact");
    } else if (key === "artworkPosition") {
      if (!ARTWORK_POSITIONS.has(item)) throw new TypeError("setup config.card.artworkPosition must be left or right");
    } else if (key === "textAlign") {
      if (!TEXT_ALIGNS.has(item)) throw new TypeError("setup config.card.textAlign must be start, middle or end");
    } else if (key === "fieldOrder") {
      if (!Array.isArray(item) || item.length !== 3 || new Set(item).size !== 3 || !item.every((field) => CARD_FIELDS.includes(field))) throw new TypeError("setup config.card.fieldOrder must list state, title and subtitle once each");
    } else if (key === "showProgress") {
      if (typeof item !== "boolean") throw new TypeError("setup config.card.showProgress must be a boolean");
    } else if (Object.hasOwn(CARD_NUMBERS, key)) {
      const [min, max] = CARD_NUMBERS[key];
      if (!Number.isInteger(item) || item < min || item > max) throw new TypeError(`setup config.card.${key} must be a whole number from ${min} to ${max}`);
    } else {
      throw new TypeError(`setup config.card.${key} is not a setting`);
    }
    card[key] = key === "fieldOrder" ? Object.freeze([...item]) : item;
  }
  return Object.freeze(card);
}

// Renderer options for a saved card section: query options on /card.svg
// still win over these.
export function cardRenderOptions(card) {
  if (!card) return Object.freeze({});
  const layout = {};
  for (const key of LAYOUT_KEYS) if (card[key] !== undefined) layout[key] = card[key];
  return Object.freeze({
    ...(card.theme ? { theme: card.theme } : {}),
    ...(card.width !== undefined ? { width: card.width } : {}),
    ...(Object.keys(layout).length ? { layout } : {}),
    ...(card.showProgress !== undefined ? { show: { progress: card.showProgress } } : {}),
  });
}

// Spotify (#135) sits beside the media servers, not in servers[]: it feeds
// the card and hosted card only, never Discord (Rowan's call), and presence
// can't yet choose between servers (#252). The user brings their own Spotify
// app's Client ID, which isn't a secret; the refresh token lives in the
// credential store under credentialRef.
function normalizeSpotify(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("setup config.spotify must be an object");
  for (const key of Object.keys(value)) {
    if (!["clientId", "identity", "credentialRef"].includes(key)) throw new TypeError(`setup config.spotify.${key} is not a setting`);
  }
  if (typeof value.clientId !== "string" || !/^[0-9a-f]{32}$/i.test(value.clientId)) throw new TypeError("setup config.spotify.clientId must be a 32-character Spotify Client ID");
  const identity = createProviderIdentity(value.identity);
  if (value.credentialRef !== undefined && (value.credentialRef?.provider !== "spotify" || value.credentialRef?.identityId !== identity.id)) {
    throw new TypeError("setup config.spotify.credentialRef does not match its identity");
  }
  return Object.freeze({
    clientId: value.clientId.toLowerCase(),
    identity,
    credentialRef: Object.freeze({ provider: "spotify", identityId: identity.id }),
  });
}

export function createSetupConfig(input = {}) {
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
  const servers = normalizeServers(input);
  const spotify = input.spotify === undefined || input.spotify === null ? null : normalizeSpotify(input.spotify);
  const config = {
    version: CONFIG_SCHEMA_VERSION,
    servers,
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
    ...(spotify ? { spotify } : {}),
  };
  // Until presence can choose between servers (#252), the rest of the app
  // runs from the first server. These mirror servers[0] and are not
  // enumerable, so they never get written back into config.json.
  const primary = servers[0];
  for (const key of ["provider", "serverUrl", "identity", "credentialRef"]) {
    Object.defineProperty(config, key, { value: primary[key], enumerable: false });
  }
  return Object.freeze(config);
}

// config.json schema version (v2: a list of servers, #252).
export const CONFIG_SCHEMA_VERSION = 2;
export const MAX_SERVERS = 8;

function normalizeServers(input) {
  const single = input.provider !== undefined || input.identity !== undefined || input.serverUrl !== undefined;
  if (input.servers !== undefined && single) throw new TypeError("setup config takes servers or a single server, not both");
  const list = input.servers ?? [{ provider: input.provider, serverUrl: input.serverUrl, identity: input.identity }];
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SERVERS) throw new TypeError(`setup config.servers must list 1 to ${MAX_SERVERS} servers`);
  const seen = new Set();
  return Object.freeze(list.map((server, index) => {
    if (!server || typeof server !== "object" || Array.isArray(server)) throw new TypeError(`setup config.servers[${index}] is invalid`);
    for (const key of Object.keys(server)) {
      if (!["provider", "serverUrl", "identity", "credentialRef"].includes(key)) throw new TypeError(`setup config.servers[${index}].${key} is not a setting`);
    }
    if (!PROVIDERS.has(server.provider)) throw new TypeError("setup config.provider is invalid");
    const identity = createProviderIdentity(server.identity);
    if (server.serverUrl !== undefined && !isServerUrl(server.serverUrl)) throw new TypeError("setup config.serverUrl is invalid");
    // One sign-in per account per server; the credential store is keyed by
    // provider + identity, so a second copy would share and overwrite it.
    const key = `${server.provider}\u0000${identity.id}`;
    if (seen.has(key)) throw new TypeError("setup config.servers lists the same account twice");
    seen.add(key);
    return Object.freeze({
      provider: server.provider,
      ...(server.serverUrl ? { serverUrl: server.serverUrl } : {}),
      identity,
      credentialRef: Object.freeze({ provider: server.provider, identityId: identity.id }),
    });
  }));
}

export function serializeSetupConfig(input) {
  return `${JSON.stringify(createSetupConfig(input), null, 2)}\n`;
}
