import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { parseAppConfig } from "./app-config.js";
import { serializeSetupConfig } from "./setup-config.js";

// Settings the web UI can change while the app runs (#253). Each change is
// checked against the same rules as setup, then config.json is replaced in one
// step (temp file + rename) so a crash never leaves half a file.

const DISCORD_KEYS = new Set(["enabled", "timestamps", "artworkLookup"]);
const HOSTED_KEYS = new Set(["enabled"]);
const PRIVACY_KEYS = new Set(["hideTitles", "hideArtwork", "hideProgress", "hideMovies", "hideEpisodes", "hideMusic"]);
const PRIVACY_KIND_KEYS = Object.freeze([["hideMovies", "movie"], ["hideEpisodes", "episode"], ["hideMusic", "track"]]);

export function discordSettingsView(config) {
  return Object.freeze({
    enabled: config.discord?.enabled !== false,
    timestamps: config.discord?.timestamps ?? "both",
    artworkLookup: config.discord?.artworkLookup ?? "off",
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

function checkChanges(changes, allowed, name) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new TypeError(`${name} settings: expected an object`);
  const keys = Object.keys(changes);
  if (!keys.length || keys.some((key) => !allowed.has(key))) throw new TypeError(`${name} settings: unknown setting`);
}

// serializeSetupConfig validates every value the same way setup does.
function rewrite(config, { discord = { ...discordSettingsView(config), timestamps: config.discord?.timestamps }, hosted = config.hosted, privacy = config.privacy } = {}) {
  const text = serializeSetupConfig({
    provider: config.provider,
    ...(config.serverUrl ? { serverUrl: config.serverUrl } : {}),
    identity: config.identity,
    credentialStored: true,
    discordEnabled: discord.enabled,
    discordIdleBehavior: config.discord?.idleBehavior,
    discordArtworkLookup: discord.artworkLookup,
    discordTimestamps: discord.timestamps,
    ...(hosted ? { hostedEnabled: hosted.enabled, ...(hosted.url ? { hostedUrl: hosted.url } : {}) } : {}),
    ...(privacy ? { privacy } : {}),
  });
  return Object.freeze({ text, config: parseAppConfig(text) });
}

export function applyDiscordChanges(config, changes) {
  checkChanges(changes, DISCORD_KEYS, "discord");
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
  });
}
