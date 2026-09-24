import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAppSettingsStore, discordSettingsView } from "./app-settings.js";
import { createCardHandler } from "./http-handler.js";
import { createCardPipeline } from "./card-pipeline.js";
import { createHttpServer } from "./http-server.js";
import { createAppStatus } from "./app-status.js";
import { createStatusPageHandler } from "./status-page-handler.js";
import { createSettingsPageHandler } from "./settings-page-handler.js";
import { createLogsPageHandler } from "./logs-page-handler.js";
import { readLogTail } from "./log-tail.js";
import { createResilientCardResolver } from "./resilient-card.js";
import { createSetupConfig } from "./setup-config.js";
import { createConfigMigrationStore } from "./config-migration-store.js";
import { createEmbyProvider } from "./providers/emby.js";
import { createJellyfinProvider } from "./providers/jellyfin.js";
import { createNavidromeProvider } from "./providers/navidrome.js";
import { createPlexProvider } from "./providers/plex.js";
import { resolveDiscordClientId } from "./discord-app.js";
import { artworkResolverOptions, createDiscordArtworkResolver } from "./discord-artwork.js";
import { createDiscordClient } from "./discord-client.js";
import { createDiscordIpcClient } from "./discord-ipc.js";
import { createDiscordPresenceLoop } from "./discord-presence.js";
import { createDiscordRpcTransport } from "./discord-rpc.js";
import { createHostedLoop } from "./hosted-loop.js";
import { createHostedUploader, DEFAULT_HOSTED_URL } from "./hosted-uploader.js";

// Runs nowplaying from the config the setup wizard writes (config.json). The
// file never holds a secret: the sign-in is read from the credential store by
// credentialRef at start-up.

const MAX_CONFIG_BYTES = 16 * 1024;
const CONFIG_KEYS = new Set(["version", "provider", "serverUrl", "identity", "credentialRef", "discord", "hosted"]);
const HOSTED_KEYS = new Set(["enabled", "url"]);

export class StartupError extends Error {
  constructor(startupCode, message) {
    super(message);
    this.name = "StartupError";
    this.startupCode = startupCode;
  }
}

export function parseAppConfig(text) {
  let parsed;
  try {
    if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) throw new RangeError("too large");
    parsed = JSON.parse(text);
  } catch {
    throw invalidConfig();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 1) throw invalidConfig();
  // Only the fields the wizard writes; anything else (a pasted token, say) means
  // the file was edited by hand and is not trusted.
  if (Object.keys(parsed).some((key) => !CONFIG_KEYS.has(key))) throw invalidConfig();
  if (parsed.hosted !== undefined && (!parsed.hosted || typeof parsed.hosted !== "object" || Array.isArray(parsed.hosted) || Object.keys(parsed.hosted).some((key) => !HOSTED_KEYS.has(key)))) throw invalidConfig();
  let config;
  try {
    config = createSetupConfig({
      provider: parsed.provider,
      serverUrl: parsed.serverUrl,
      identity: parsed.identity,
      credentialStored: true,
      discordEnabled: parsed.discord?.enabled,
      discordIdleBehavior: parsed.discord?.idleBehavior,
      discordArtworkLookup: parsed.discord?.artworkLookup,
      discordTimestamps: parsed.discord?.timestamps,
      ...(parsed.hosted ? { hostedEnabled: parsed.hosted.enabled, hostedUrl: parsed.hosted.url } : {}),
    });
  } catch {
    throw invalidConfig();
  }
  // The credential reference must point at the signed-in identity, and the app
  // needs a server to talk to.
  if (parsed.credentialRef?.provider !== config.provider || parsed.credentialRef?.identityId !== config.identity.id || !config.serverUrl) {
    throw invalidConfig();
  }
  return config;
}

// Config schema version this build writes and reads. When it goes up, add a
// migration for the old version below; the store backs the file up first
// (config.json.backup-<time>) and only replaces it with a validated result.
export const CONFIG_VERSION = 1;
const CONFIG_MIGRATIONS = Object.freeze([
  // 0 -> 1: no version-0 file was ever released.
  () => { throw new Error("unsupported"); },
]);

/**
 * Upgrades config.json to CONFIG_VERSION if needed (backup first).
 * Throws CONFIG_TOO_NEW for a newer file; any other failure leaves the file
 * alone and returns status "failed" so loadAppConfig reports it as usual.
 */
export async function migrateAppConfig(file, { clock } = {}) {
  const store = createConfigMigrationStore({
    file,
    currentVersion: CONFIG_VERSION,
    migrations: CONFIG_MIGRATIONS,
    validate: (document) => { parseAppConfig(JSON.stringify(document)); return document; },
    ...(clock ? { clock } : {}),
  });
  try {
    return await store.migrate();
  } catch (error) {
    if (error instanceof RangeError) throw new StartupError("CONFIG_TOO_NEW", "This config was saved by a newer NowPlaying. Update NowPlaying, or run `nowplaying.exe setup` to start again.");
    // Anything else (malformed, unreadable, failed migration) is reported by
    // loadAppConfig with the usual message; the file is left untouched.
    return Object.freeze({ changed: false, status: "failed", backup: null });
  }
}

export async function loadAppConfig(file) {
  await migrateAppConfig(file);
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new StartupError("CONFIG_MISSING", "NowPlaying isn't set up yet. Run `nowplaying.exe setup` first.");
    throw new StartupError("CONFIG_LOAD_FAILED", "Couldn't read the NowPlaying config. Run `nowplaying.exe setup` again.");
  }
  return parseAppConfig(text);
}

export function createProviderFromConfig(config, secret, { fetchImpl = fetch } = {}) {
  const baseUrl = config.serverUrl;
  const inner = (() => {
    switch (config.provider) {
      case "plex": return createPlexProvider({ baseUrl, token: secret, fetchImpl });
      case "jellyfin": return createJellyfinProvider({ baseUrl, apiKey: secret, fetchImpl });
      case "emby": return createEmbyProvider({ baseUrl, apiKey: secret, fetchImpl });
      case "navidrome": {
        let parts;
        try { parts = JSON.parse(secret); } catch { throw credentialMissing(); }
        return createNavidromeProvider({ baseUrl, username: config.identity.id, token: parts?.token, salt: parts?.salt, fetchImpl });
      }
      default: throw invalidConfig();
    }
  })();
  // Only show what the signed-in user is playing, not everyone on the server.
  // Plex, Jellyfin and Emby match on the stable user ID so a rename or a
  // duplicate display name can't pick up someone else's session.
  const filter = config.provider === "navidrome" ? { username: config.identity.id } : { userId: config.identity.id };
  return Object.freeze({ ...inner, getPresence: () => inner.getPresence(filter) });
}

function defaultDiscordTransport(clientId) {
  return createDiscordRpcTransport({ clientId, createClient: async () => createDiscordIpcClient() });
}

// Discord runs only when setup turned it on and the build has an application
// ID. Discord not running is fine: the client retries in the background.
// Artwork: a public HTTPS image from the server is used as is; private or
// local server images fall back to the NowPlaying icon image. No title or artist
// leaves the machine unless the config has artworkLookup "musicbrainz" (the
// default for new setups, off for configs written before it existed).
export function startDiscordFromConfig(config, provider, { env = process.env, builtInClientId, createTransport = defaultDiscordTransport, createArtwork = (settings) => createDiscordArtworkResolver(artworkResolverOptions(settings)), intervalMs, now } = {}) {
  if (!config.discord?.enabled) return Object.freeze({ status: "off", stop: async () => {} });
  const clientId = resolveDiscordClientId({ env, ...(builtInClientId !== undefined ? { builtIn: builtInClientId } : {}) });
  if (!clientId) return Object.freeze({ status: "no_app_id", stop: async () => {} });
  const client = createDiscordClient({ transport: createTransport(clientId), ...(now ? { now } : {}) });
  const artwork = createArtwork(config.discord);
  const loop = createDiscordPresenceLoop({ getPresence: () => provider.getPresence(), client, artwork, idleBehavior: config.discord.idleBehavior, timestamps: config.discord.timestamps ?? "both", ...(intervalMs ? { intervalMs } : {}), ...(now ? { now } : {}) });
  loop.start();
  return Object.freeze({ status: "on", connection: () => loop.status(), stop: () => loop.stop() });
}

// Hosted card upload (#140) runs only when the config turns it on. It pushes
// privacy-filtered state to the hosted service and is independent of Discord:
// a host that's down or unreachable never affects presence.
export function startHostedFromConfig(config, provider, { credentials, fetchImpl = fetch, settings = {}, intervalMs, createUploader = createHostedUploader } = {}) {
  if (!config.hosted?.enabled) return Object.freeze({ status: "off", stop: async () => {}, cardUrl: async () => null, connection: () => null });
  if (typeof credentials?.load !== "function") return Object.freeze({ status: "no_credentials", stop: async () => {}, cardUrl: async () => null, connection: () => null });
  const uploader = createUploader({ baseUrl: config.hosted.url ?? DEFAULT_HOSTED_URL, credentials, fetchImpl, settings });
  const loop = createHostedLoop({ getPresence: () => provider.getPresence(), uploader, ...(intervalMs ? { intervalMs } : {}) });
  loop.start();
  return Object.freeze({ status: "on", stop: () => loop.stop(), cardUrl: () => uploader.cardUrl(), connection: () => uploader.status() });
}

// 3000 clashes with most dev servers, so the local app uses a rarely used port.
// Override with NOWPLAYING_PORT (see resolveAppPort).
export const DEFAULT_APP_PORT = 47832;

export function resolveAppPort(env = process.env) {
  const raw = env?.NOWPLAYING_PORT;
  if (raw === undefined || raw === "") return DEFAULT_APP_PORT;
  const port = Number(raw);
  if (!/^\d{1,5}$/.test(String(raw)) || port < 1024 || port > 65535) {
    throw new StartupError("CONFIG_INVALID", "NOWPLAYING_PORT must be a number from 1024 to 65535.");
  }
  return port;
}

export async function startAppFromConfig({ configFile, credentialStore, host = "127.0.0.1", port = DEFAULT_APP_PORT, fetchImpl = fetch, discord: discordOptions = {}, version = null, build = null, packageType = null, hostedCredentials, hosted: hostedOptions = {}, safeMode = false, logFile = null } = {}) {
  if (typeof credentialStore?.read !== "function") throw new TypeError("credentialStore.read is required");
  const config = await loadAppConfig(configFile);
  // Safe mode (#122) is offline: no sign-in read and no server polling, so a
  // broken sign-in or an unreachable server can't keep the start crashing. The
  // card shows idle; the status, settings and logs pages still work.
  const provider0 = safeMode ? OFFLINE_PROVIDER : await createSignedInProvider(config, credentialStore, fetchImpl);
  const status = createAppStatus({ config, version, build, packageType, safeMode });
  const provider = safeMode ? provider0 : status.wrapProvider(provider0);
  const resolveCard = createResilientCardResolver({ resolveCard: createCardPipeline({ provider }), diagnostics: true });
  let current = config;
  let discord;
  // Safe mode (#122, after repeated failed starts): only the local card and
  // status page run. Discord and hosted uploads, which poll in the background,
  // stay off until the user retries a normal start, even if Discord settings
  // are changed from the settings page meanwhile.
  const paused = Object.freeze({ status: "safe_mode", stop: async () => {}, cardUrl: async () => null, connection: () => null });
  const launchDiscord = (settings) => {
    if (safeMode) return paused;
    try { return startDiscordFromConfig(settings, provider, discordOptions); }
    catch { return Object.freeze({ status: "failed", stop: async () => {} }); }
  };
  // Discord changes from the settings page are saved to config.json first,
  // then the Discord loop restarts with them; no app restart needed.
  const settingsStore = createAppSettingsStore({ file: configFile });
  const settings = Object.freeze({
    read: () => ({ discord: discordSettingsView(current) }),
    async updateDiscord(changes) {
      const next = await settingsStore.updateDiscord(changes);
      current = next;
      await discord.stop().catch(() => {});
      discord = launchDiscord(next);
    },
  });
  const statusHandler = createStatusPageHandler({ status, fallback: createCardHandler({ resolveCard }) });
  // The Logs page reads the app log (no log file, e.g. a dev checkout: empty).
  const logsHandler = createLogsPageHandler({ readEvents: () => readLogTail(logFile), fallback: statusHandler });
  const handler = createSettingsPageHandler({ settings, fallback: logsHandler });
  // Saves need the cookie the app's own pages set, so another local program
  // or web page can't change settings.
  const server = createHttpServer({ host, port, handler, sessionSecret: randomBytes(32).toString("base64url") });
  let address;
  try {
    address = await server.listen();
  } catch (error) {
    if (error?.code === "EADDRINUSE") throw new StartupError("PORT_IN_USE", `Port ${port} is already in use. Close the other program using it and try again.`);
    throw new StartupError("SERVER_START_FAILED", "Couldn't start the local card server.");
  }
  const authority = address.family === "IPv6" ? `[${address.address}]` : address.address;
  discord = launchDiscord(config);
  status.setDiscord(() => discord.status === "on"
    ? { enabled: true, ...discord.connection() }
    : { enabled: discord.status !== "off", state: discord.status });
  let hosted;
  try {
    hosted = safeMode ? paused : startHostedFromConfig(config, provider, { credentials: hostedCredentials, fetchImpl, ...hostedOptions });
  } catch {
    hosted = Object.freeze({ status: "failed", stop: async () => {}, cardUrl: async () => null, connection: () => null });
  }
  status.setHosted(() => hosted.status === "on"
    ? { enabled: true, ...hosted.connection() }
    : { enabled: hosted.status !== "off", state: hosted.status });
  const close = async () => {
    await hosted.stop().catch(() => {});
    await discord.stop().catch(() => {});
    await server.close();
  };
  return Object.freeze({ config, url: `http://${authority}:${address.port}`, get discord() { return discord.status; }, hosted: hosted.status, hostedCardUrl: () => hosted.cardUrl(), safeMode, status, close });
}

const OFFLINE_PROVIDER = Object.freeze({ getPresence: async () => ({ state: "idle" }) });

async function createSignedInProvider(config, credentialStore, fetchImpl) {
  let secret;
  try {
    secret = await credentialStore.read(config.credentialRef);
  } catch {
    throw new StartupError("CREDENTIAL_READ_FAILED", "Couldn't read your saved sign-in from Windows Credential Manager. Run `nowplaying.exe setup` to sign in again.");
  }
  if (typeof secret !== "string" || !secret) throw credentialMissing();
  try {
    return createProviderFromConfig(config, secret, { fetchImpl });
  } catch (error) {
    if (error instanceof StartupError) throw error;
    throw invalidConfig();
  }
}

function invalidConfig() {
  return new StartupError("CONFIG_INVALID", "The NowPlaying config is damaged or out of date. Run `nowplaying.exe setup` again.");
}

function credentialMissing() {
  return new StartupError("CREDENTIAL_MISSING", "Your saved sign-in is missing from Windows Credential Manager. Run `nowplaying.exe setup` to sign in again.");
}
