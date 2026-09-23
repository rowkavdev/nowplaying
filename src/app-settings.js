import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { parseAppConfig } from "./app-config.js";
import { serializeSetupConfig } from "./setup-config.js";

// Settings the web UI can change while the app runs (#253). Each change is
// checked against the same rules as setup, then config.json is replaced in one
// step (temp file + rename) so a crash never leaves half a file.

const DISCORD_KEYS = new Set(["enabled", "timestamps", "artworkLookup"]);

export function discordSettingsView(config) {
  return Object.freeze({
    enabled: config.discord?.enabled !== false,
    timestamps: config.discord?.timestamps ?? "both",
    artworkLookup: config.discord?.artworkLookup ?? "off",
  });
}

export function applyDiscordChanges(config, changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new TypeError("discord settings: expected an object");
  const keys = Object.keys(changes);
  if (!keys.length || keys.some((key) => !DISCORD_KEYS.has(key))) throw new TypeError("discord settings: unknown setting");
  const current = discordSettingsView(config);
  const next = { ...current, ...changes };
  // serializeSetupConfig validates every value the same way setup does.
  const text = serializeSetupConfig({
    provider: config.provider,
    ...(config.serverUrl ? { serverUrl: config.serverUrl } : {}),
    identity: config.identity,
    credentialStored: true,
    discordEnabled: next.enabled,
    discordIdleBehavior: config.discord?.idleBehavior,
    discordArtworkLookup: next.artworkLookup,
    discordTimestamps: next.timestamps,
    ...(config.hosted ? { hostedEnabled: config.hosted.enabled, ...(config.hosted.url ? { hostedUrl: config.hosted.url } : {}) } : {}),
  });
  return Object.freeze({ text, config: parseAppConfig(text) });
}

export function createAppSettingsStore({ file } = {}) {
  if (typeof file !== "string" || !file) throw new TypeError("file is required");
  let queue = Promise.resolve();
  async function updateDiscord(changes) {
    const current = parseAppConfig(await readFile(file, "utf8"));
    const { text, config } = applyDiscordChanges(current, changes);
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
  return Object.freeze({
    // One write at a time: two quick saves never race each other.
    updateDiscord(changes) {
      const run = queue.then(() => updateDiscord(changes));
      queue = run.catch(() => {});
      return run;
    },
  });
}
