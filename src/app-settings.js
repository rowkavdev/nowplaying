import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { parseAppConfig } from "./app-config.js";
import { normalizeCard, serializeSetupConfig } from "./setup-config.js";
import { IDLE_BEHAVIORS } from "./discord-presence.js";

// Settings the web UI can change while the app runs (#253). Each change is
// checked against the same rules as setup, then config.json is replaced in one
// step (temp file + rename) so a crash never leaves half a file.

const DISCORD_KEYS = new Set(["enabled", "timestamps", "artworkLookup", "idleBehavior"]);
const HOSTED_KEYS = new Set(["enabled"]);
const PRIVACY_KEYS = new Set(["hideTitles", "hideArtwork", "hideProgress", "hideMovies", "hideEpisodes", "hideMusic"]);
const PRIVACY_KIND_KEYS = Object.freeze([["hideMovies", "movie"], ["hideEpisodes", "episode"], ["hideMusic", "track"]]);

export function discordSettingsView(config) {
  return Object.freeze({
    enabled: config.discord?.enabled !== false,
    timestamps: config.discord?.timestamps ?? "both",
    artworkLookup: config.discord?.artworkLookup ?? "off",
    idleBehavior: config.discord?.idleBehavior ?? "clear",
  });
}

export function hostedSettingsView(config) {
  return Object.freeze({ enabled: config.hosted?.enabled === true });
}

export function privacySettingsView(config) {
  const privacy = config.privacy ?? {};
  const kinds = privacy.suppressMediaKinds ?? [];
  return Object.freeze({
    hideTitles: privacy.redactTitles === true,
    hideArtwork: privacy.hideArtwork === true,
    hideProgress: privacy.hideProgress === true,
    ...Object.fromEntries(PRIVACY_KIND_KEYS.map(([key, kind]) => [key, kinds.includes(kind)])),
  });
}

// Card appearance (#94). Defaults are the renderer's own, so a page that
// shows them draws the same card as a config without a card section.
const CARD_KEYS = new Set(["theme", "width", "padding", "radius", "progressHeight", "showProgress", "artworkPosition", "artworkWidth", "artworkHeight", "fieldOrder", "textAlign", "progressPosition", "progressWidth", "direction", "artworkTint"]);
export function cardSettingsView(config) {
  const card = config.card ?? {};
  const theme = card.theme ?? "midnight-blue";
  return Object.freeze({
    theme,
    width: card.width ?? 440,
    padding: card.padding ?? 24,
    radius: card.radius ?? 10,
    progressHeight: card.progressHeight ?? 4,
    // The compact theme hides progress unless it's turned on.
    showProgress: card.showProgress ?? theme !== "compact",
    artworkPosition: card.artworkPosition ?? "left",
    artworkWidth: card.artworkWidth ?? 68,
    artworkHeight: card.artworkHeight ?? 100,
    fieldOrder: card.fieldOrder ?? ["state", "title", "subtitle"],
    textAlign: card.textAlign ?? "start",
    progressPosition: card.progressPosition ?? "bottom",
    progressWidth: card.progressWidth ?? "content",
    direction: card.direction ?? "ltr",
    artworkTint: card.artworkTint ?? true,
  });
}

function checkChanges(changes, allowed, name) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new TypeError(`${name} settings: expected an object`);
  const keys = Object.keys(changes);
  if (!keys.length || keys.some((key) => !allowed.has(key))) throw new TypeError(`${name} settings: unknown setting`);
}

// serializeSetupConfig validates every value the same way setup does.
function rewrite(config, { servers = config.servers, discord = { ...discordSettingsView(config), timestamps: config.discord?.timestamps }, hosted = config.hosted, privacy = config.privacy, card = config.card } = {}) {
  const text = serializeSetupConfig({
    // Every server is kept; settings changes never drop one (#252).
    servers: servers.map(({ provider, serverUrl, identity }) => ({ provider, ...(serverUrl ? { serverUrl } : {}), identity })),
    credentialStored: true,
    discordEnabled: discord.enabled,
    discordIdleBehavior: discord.idleBehavior,
    discordArtworkLookup: discord.artworkLookup,
    discordTimestamps: discord.timestamps,
    ...(hosted ? { hostedEnabled: hosted.enabled, ...(hosted.url ? { hostedUrl: hosted.url } : {}) } : {}),
    ...(privacy ? { privacy } : {}),
    ...(card ? { card } : {}),
    // Settings changes never drop the Spotify connection (#135).
    ...(config.spotify ? { spotify: { clientId: config.spotify.clientId, identity: config.spotify.identity } } : {}),
  });
  return Object.freeze({ text, config: parseAppConfig(text) });
}

export function applyDiscordChanges(config, changes) {
  checkChanges(changes, DISCORD_KEYS, "discord");
  if (changes.idleBehavior !== undefined && !IDLE_BEHAVIORS.includes(changes.idleBehavior)) throw new TypeError("discord settings: idleBehavior is invalid");
  return rewrite(config, { discord: { ...discordSettingsView(config), ...changes } });
}

// Only on/off: the service address stays whatever setup or config.json says.
export function applyHostedChanges(config, changes) {
  checkChanges(changes, HOSTED_KEYS, "hosted");
  return rewrite(config, { hosted: { ...(config.hosted ?? {}), enabled: changes.enabled } });
}

export function applyPrivacyChanges(config, changes) {
  checkChanges(changes, PRIVACY_KEYS, "privacy");
  for (const [key, value] of Object.entries(changes)) if (typeof value !== "boolean") throw new TypeError(`privacy settings: ${key} must be true or false`);
  const view = { ...privacySettingsView(config), ...changes };
  return rewrite(config, { privacy: {
    redactTitles: view.hideTitles,
    hideArtwork: view.hideArtwork,
    hideProgress: view.hideProgress,
    suppressMediaKinds: PRIVACY_KIND_KEYS.filter(([key]) => view[key]).map(([, kind]) => kind),
  } });
}

export function applyCardChanges(config, changes) {
  checkChanges(changes, CARD_KEYS, "card");
  return rewrite(config, { card: normalizeCard({ ...cardSettingsView(config), ...changes }) });
}

// Media servers for the settings page (#252): who is signed in where. No
// credentials; those stay in the credential store.
export function serversSettingsView(config) {
  return Object.freeze(config.servers.map((server) => Object.freeze({
    provider: server.provider,
    id: server.identity.id,
    displayName: server.identity.displayName,
    ...(server.serverUrl ? { serverUrl: server.serverUrl } : {}),
  })));
}

// Drops one server from config.json. The last server can't be removed (the
// app needs one to run). Deleting its saved sign-in from the credential store
// is left to the caller, which owns the store.
export function applyServerRemoval(config, { provider, id } = {}) {
  const servers = config.servers.filter((server) => !(server.provider === provider && server.identity.id === id));
  if (servers.length === config.servers.length) throw new TypeError("servers settings: that server isn't in the config");
  if (servers.length === 0) throw new TypeError("servers settings: keep at least one server");
  return rewrite(config, { servers });
}

export function createAppSettingsStore({ file } = {}) {
  if (typeof file !== "string" || !file) throw new TypeError("file is required");
  let queue = Promise.resolve();
  async function update(apply, changes) {
    const current = parseAppConfig(await readFile(file, "utf8"));
    const { text, config } = apply(current, changes);
    const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return config;
  }
  function queued(task) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }
  return Object.freeze({
    // One write at a time: two quick saves never race each other.
    updateDiscord: (changes) => queued(() => update(applyDiscordChanges, changes)),
    updateHosted: (changes) => queued(() => update(applyHostedChanges, changes)),
    updatePrivacy: (changes) => queued(() => update(applyPrivacyChanges, changes)),
    updateCard: (changes) => queued(() => update(applyCardChanges, changes)),
  });
}
