import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cardSettingsView, createAppSettingsStore, discordSettingsView, hostedSettingsView, privacySettingsView } from "./app-settings.js";
import { renderCard } from "./card.js";
import { createCardHandler } from "./http-handler.js";
import { createCardPipeline } from "./card-pipeline.js";
import { createHttpServer } from "./http-server.js";
import { createAppStatus } from "./app-status.js";
import { createStatusPageHandler } from "./status-page-handler.js";
import { createFirstRunSettingsHandler, createSettingsPageHandler } from "./settings-page-handler.js";
import { createSettingsServers } from "./settings-servers.js";
import { createSettingsConnectedServices } from "./settings-connected-services.js";
import { createHostedDevicesClient, createHostedDevicesHandler } from "./hosted-devices.js";
import { createLogsPageHandler } from "./logs-page-handler.js";
import { readLogTail } from "./log-tail.js";
import { createResilientCardResolver } from "./resilient-card.js";
import { cardRenderOptions, createSetupConfig } from "./setup-config.js";
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
import { withProviderBackoff } from "./provider-backoff.js";
import { createMultiServerProvider } from "./multi-server.js";
import { createArtworkCache } from "./artwork-cache.js";
import { createArtworkService } from "./artwork-service.js";
import { applyPrivacy } from "./privacy.js";
import { combinePresence, createSpotifySource } from "./spotify-source.js";
import { YOUTUBE_BRIDGE_PATH, createYouTubeBridge, createYouTubeBridgeHandler, loadYouTubePairingToken, resetYouTubePairingToken } from "./youtube-bridge.js";

// Runs nowplaying from the config the setup wizard writes (config.json). The
// file never holds a secret: the sign-in is read from the credential store by
// credentialRef at start-up.

const MAX_CONFIG_BYTES = 16 * 1024;
const CONFIG_KEYS = new Set(["version", "servers", "discord", "hosted", "privacy", "card", "spotify"]);
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
  // Notepad's "UTF-8 with BOM" and PowerShell 5's Set-Content/Out-File start the
  // file with U+FEFF, which JSON.parse rejects. Drop one leading mark only.
  if (typeof text === "string" && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) throw new RangeError("too large");
    parsed = JSON.parse(text);
  } catch {
    throw invalidConfig();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== CONFIG_VERSION) throw invalidConfig();
  // Only the fields the wizard writes; anything else (a pasted token, say) means
  // the file was edited by hand and is not trusted.
  if (Object.keys(parsed).some((key) => !CONFIG_KEYS.has(key))) throw invalidConfig();
  if (parsed.hosted !== undefined && (!parsed.hosted || typeof parsed.hosted !== "object" || Array.isArray(parsed.hosted) || Object.keys(parsed.hosted).some((key) => !HOSTED_KEYS.has(key)))) throw invalidConfig();
  let config;
  try {
    config = createSetupConfig({
      servers: parsed.servers,
      credentialStored: true,
      discordEnabled: parsed.discord?.enabled,
      discordIdleBehavior: parsed.discord?.idleBehavior,
      discordArtworkLookup: parsed.discord?.artworkLookup,
      discordTimestamps: parsed.discord?.timestamps,
      ...(parsed.hosted ? { hostedEnabled: parsed.hosted.enabled, hostedUrl: parsed.hosted.url } : {}),
      ...(parsed.privacy !== undefined ? { privacy: parsed.privacy } : {}),
      ...(parsed.card !== undefined ? { card: parsed.card } : {}),
      ...(parsed.spotify !== undefined ? { spotify: parsed.spotify } : {}),
    });
  } catch {
    throw invalidConfig();
  }
  // Each credential reference must point at that server's signed-in identity,
  // and the app needs an address for every server.
  const refsMatch = config.servers.every((server, index) => {
    const ref = parsed.servers[index]?.credentialRef;
    return ref?.provider === server.provider && ref?.identityId === server.identity.id && server.serverUrl;
  });
  if (!refsMatch) throw invalidConfig();
  return config;
}

// Config schema version this build writes and reads. When it goes up, add a
// migration for the old version below; the store backs the file up first
// (config.json.backup-<time>) and only replaces it with a validated result.
export const CONFIG_VERSION = 2;
const CONFIG_MIGRATIONS = Object.freeze([
  // 0 -> 1: no version-0 file was ever released.
  () => { throw new Error("unsupported"); },
  // 1 -> 2 (#252): the single server moves into a one-item servers list.
  migrateV1ToV2,
]);

export function migrateV1ToV2(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("unsupported");
  const { provider, serverUrl, identity, credentialRef, version: _version, ...rest } = document;
  const server = { provider, ...(serverUrl !== undefined ? { serverUrl } : {}), identity, credentialRef };
  return { ...rest, version: 2, servers: [server] };
}

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

// Privacy (#253): one policy for everything that leaves the app - Discord,
// the hosted card and the local card. "episode" also covers whole-series items.
export function privacyPolicyFromConfig(config) {
  const privacy = config?.privacy ?? {};
  const kinds = privacy.suppressMediaKinds ?? [];
  return Object.freeze({
    redactTitles: privacy.redactTitles === true,
    hideArtwork: privacy.hideArtwork === true,
    hideProgress: privacy.hideProgress === true,
    suppressMediaKinds: Object.freeze(kinds.includes("episode") ? [...kinds, "show"] : [...kinds]),
  });
}

function hidesAnything(policy) {
  return policy.redactTitles || policy.hideArtwork || policy.hideProgress || policy.suppressMediaKinds.length > 0;
}

// Reads the policy on every poll, so a saved change applies straight away.
export function withPrivacy(provider, getConfig) {
  return Object.freeze({
    ...provider,
    getPresence: async (...args) => {
      const presence = await provider.getPresence(...args);
      const policy = privacyPolicyFromConfig(getConfig());
      return presence && hidesAnything(policy) ? applyPrivacy(presence, policy) : presence;
    },
  });
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
export function startDiscordFromConfig(config, provider, { env = process.env, builtInClientId, createTransport = defaultDiscordTransport, createArtwork = (settings) => createDiscordArtworkResolver(artworkResolverOptions(settings)), intervalMs, stuckAfterMs, now } = {}) {
  if (!config.discord?.enabled) return Object.freeze({ status: "off", stop: async () => {}, refreshArtwork: async () => 0 });
  const clientId = resolveDiscordClientId({ env, ...(builtInClientId !== undefined ? { builtIn: builtInClientId } : {}) });
  if (!clientId) return Object.freeze({ status: "no_app_id", stop: async () => {}, refreshArtwork: async () => 0 });
  const client = createDiscordClient({ transport: createTransport(clientId), ...(now ? { now } : {}) });
  // Hidden titles or album art: never look covers up by title.
  const policy = privacyPolicyFromConfig(config);
  const artwork = createArtwork(policy.redactTitles || policy.hideArtwork ? { ...config.discord, artworkLookup: "off" } : config.discord);
  const loop = createDiscordPresenceLoop({ getPresence: () => provider.getPresence(), client, artwork, idleBehavior: config.discord.idleBehavior, timestamps: config.discord.timestamps ?? "both", ...(intervalMs ? { intervalMs } : {}), ...(stuckAfterMs ? { stuckAfterMs } : {}), ...(now ? { now } : {}) });
  loop.start();
  // Refresh artwork: forget cached covers, then update Discord straight away.
  async function refreshArtwork() {
    const dropped = typeof artwork?.clear === "function" ? artwork.clear() : 0;
    await loop.tick().catch(() => null);
    return dropped;
  }
  // The status page shows which artwork source Discord got and why it fell
  // back (#154), as short words only - never a URL or host.
  const connection = () => ({ ...loop.status(), artwork: typeof artwork?.status === "function" ? artwork.status() : null });
  return Object.freeze({ status: "on", connection, stop: () => loop.stop(), refreshArtwork });
}

// What the hosted uploader may send (#140): the privacy policy plus the card's
// own field switches, so a field the card doesn't show never leaves the PC.
// The setup and settings previews use the same function.
export function hostedUploadSettings(config) {
  const theme = config?.card?.theme ?? "midnight-blue";
  return Object.freeze({
    privacy: privacyPolicyFromConfig(config),
    show: Object.freeze({ progress: config?.card?.showProgress ?? theme !== "compact" }),
  });
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
  return Object.freeze({ status: "on", stop: () => loop.stop(), cardUrl: () => uploader.cardUrl(), connection: () => uploader.status(), disconnect: () => uploader.disconnect() });
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

export function youtubeForDiscord(source) {
  return Object.freeze({
    async getPresence() {
      const presence = await source.getPresence();
      return presence?.kind === "unknown" && presence.state !== "idle" ? { ...presence, kind: "show" } : presence;
    },
  });
}

export async function startAppFromConfig({ configFile, credentialStore, host = "127.0.0.1", port = DEFAULT_APP_PORT, fetchImpl = fetch, discord: discordOptions = {}, version = null, build = null, packageType = null, hostedCredentials, hosted: hostedOptions = {}, safeMode = false, logFile = null, startup = null, providerBackoff = {}, requestSetup = null, deviceId = null, onConfigured = async () => {}, discoverServers, signIn, spotifySignIn, hostedSignIn, createServer = createHttpServer } = {}) {
  if (typeof credentialStore?.read !== "function") throw new TypeError("credentialStore.read is required");
  let config;
  try { config = await loadAppConfig(configFile); }
  catch (error) {
    if (error?.startupCode !== "CONFIG_MISSING" || !configFile) throw error;
    if (typeof credentialStore.save !== "function" || !/^[A-Za-z0-9_-]{8,128}$/.test(deviceId ?? "")) throw new StartupError("SETUP_UNAVAILABLE", "A credential store and stable device ID are needed to connect a server. Run `nowplaying setup` or install the desktop app.");
    const services = createSettingsConnectedServices({ file: configFile, credentialStore, hostedCredentials, onConfigured, fetchImpl, ...(spotifySignIn ? { spotifySignIn } : {}), ...(hostedSignIn ? { hostedSignIn } : {}) });
    const management = createSettingsServers({ file: configFile, credentialStore, deviceId, version: version ?? "0", onConfigured, beforeRestart: services.afterFirstServer, ...(discoverServers ? { discover: discoverServers } : {}), ...(signIn ? { signIn } : {}) });
    const handler = createFirstRunSettingsHandler({ servers: async (request) => (await services.handler(request)) ?? management.handler(request) });
    const server = createServer({ host, port, handler, sessionSecret: randomBytes(32).toString("base64url") });
    let address;
    try { address = await server.listen(); }
    catch (listenError) { if (listenError?.code === "EADDRINUSE") throw new StartupError("PORT_IN_USE", `Port ${port} is already in use.`); throw listenError; }
    const authority = address.family === "IPv6" ? `[${address.address}]` : address.address;
    return Object.freeze({ firstRun: true, url: `http://${authority}:${address.port}`, close: () => server.close() });
  }
  // Safe mode (#122) is offline: no sign-in read and no server polling, so a
  // broken sign-in or an unreachable server can't keep the start crashing. The
  // card shows idle; the status, settings and logs pages still work.
  // A failing server is retried with backoff (#153), shared by the card,
  // Discord, hosted uploads and the status page.
  // Every signed-in server is polled (#252); the first one's sign-in must
  // work as before, the others show as unavailable on the status page instead
  // of stopping the start.
  const multi = safeMode ? null : await createServersProvider(config, credentialStore, fetchImpl, providerBackoff);
  const provider0 = safeMode ? OFFLINE_PROVIDER : multi;
  const status = createAppStatus({ config, version, build, packageType, safeMode });
  const tracked = safeMode ? provider0 : status.wrapProvider(provider0);
  if (multi) status.setServers(() => multi.servers());
  let current = config;
  // The status page (local only) sees what's really playing; the card,
  // Discord and hosted uploads get the privacy-filtered version.
  const provider = withPrivacy(tracked, () => current);
  // Spotify (#135) feeds the local card, its preview and the hosted card,
  // never Discord (Rowan's call). When it and the media server are both
  // playing, whichever started most recently shows. A Spotify problem never
  // stops the start; it just isn't shown.
  let spotify = null;
  if (!safeMode && config.spotify) {
    try { spotify = createSpotifySource(config, credentialStore, { fetchImpl, backoff: providerBackoff }); } catch { spotify = null; }
  }
  // YouTube (#136): the browser extension posts to /bridge/youtube. Same
  // rules as Spotify: card only, never Discord, most recent start wins, and
  // a problem here never stops the start.
  let youtube = null;
  if (!safeMode) {
    try {
      const token = await loadYouTubePairingToken(credentialStore);
      youtube = { bridge: createYouTubeBridge({ token }), token };
    } catch { youtube = null; }
  }
  let cardSource = tracked;
  if (spotify) cardSource = combinePresence({ primary: cardSource, secondary: spotify });
  if (youtube) cardSource = combinePresence({ primary: cardSource, secondary: youtube.bridge.provider });
  const cardProvider = cardSource === tracked ? provider : withPrivacy(cardSource, () => current);
  // Discord gets YouTube too (Rowan, #136), never Spotify. A plain YouTube
  // video shows as "Watching"; YouTube Music stays "Listening". Shorts never
  // reach the bridge.
  const discordProvider = youtube ? withPrivacy(combinePresence({ primary: tracked, secondary: youtubeForDiscord(youtube.bridge.provider) }), () => current) : provider;
  const resolveCard = createResilientCardResolver({ resolveCard: createCardPipeline({ provider: cardProvider, artworkService: multi?.artwork, defaults: () => cardRenderOptions(current.card) }), diagnostics: true });
  let discord;
  // Safe mode (#122, after repeated failed starts): only the local card and
  // status page run. Discord and hosted uploads, which poll in the background,
  // stay off until the user retries a normal start, even if Discord settings
  // are changed from the settings page meanwhile.
  const paused = Object.freeze({ status: "safe_mode", stop: async () => {}, cardUrl: async () => null, connection: () => null, refreshArtwork: async () => 0 });
  const offHosted = Object.freeze({ status: "off", stop: async () => {}, cardUrl: async () => null, connection: () => null });
  let hosted = offHosted;
  const launchHosted = (settings) => {
    if (safeMode) return paused;
    try { return startHostedFromConfig(settings, cardProvider, { credentials: hostedCredentials, fetchImpl, settings: () => hostedUploadSettings(current), ...hostedOptions }); }
    catch { return Object.freeze({ status: "failed", stop: async () => {}, cardUrl: async () => null, connection: () => null }); }
  };
  const launchDiscord = (settings) => {
    if (safeMode) return paused;
    try { return startDiscordFromConfig(settings, discordProvider, discordOptions); }
    catch { return Object.freeze({ status: "failed", stop: async () => {}, refreshArtwork: async () => 0 }); }
  };
  // Discord changes from the settings page are saved to config.json first,
  // then the Discord loop restarts with them; no app restart needed.
  const settingsStore = createAppSettingsStore({ file: configFile });
  // Hosted card on/off works the same way. Disconnect revokes this PC's device
  // key on the service, deletes it from Credential Manager and turns upload off.
  const hostedView = async () => {
    const view = { ...hostedSettingsView(current), state: hosted.status, lastSuccessAt: null, error: null, cardUrl: null };
    if (hosted.status !== "on") return view;
    const connection = hosted.connection() ?? {};
    let cardUrl = null;
    try { cardUrl = await hosted.cardUrl(); } catch { cardUrl = null; }
    return { ...view, state: connection.state ?? "idle", lastSuccessAt: connection.lastSuccessAt ? new Date(connection.lastSuccessAt).toISOString() : null, error: connection.lastError ?? null, cardUrl };
  };
  const startupView = async () => {
    if (typeof startup?.isEnabled !== "function") return { available: false, startWithWindows: false };
    try {
      const state = typeof startup.status === "function" ? await startup.status() : { enabled: await startup.isEnabled(), broken: false };
      return { available: true, startWithWindows: state.enabled, ...(state.broken ? { shortcutBroken: true } : {}) };
    }
    catch { return { available: false, startWithWindows: false }; }
  };
  const settings = Object.freeze({
    read: async () => ({ discord: discordSettingsView(current), hosted: await hostedView(), startup: await startupView(), privacy: privacySettingsView(current), card: cardSettingsView(current) }),
    // Start with Windows is the Startup-folder shortcut, not config.json:
    // setup and this page change the same shortcut.
    async updateStartup(changes) {
      if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length !== 1 || typeof changes.startWithWindows !== "boolean") throw new TypeError("startup settings: expected startWithWindows");
      if (!startup) throw new TypeError("startup settings: not available");
      await startup.setEnabled(changes.startWithWindows);
    },
    async updateDiscord(changes) {
      const next = await settingsStore.updateDiscord(changes);
      current = next;
      await discord.stop().catch(() => {});
      discord = launchDiscord(next);
    },
    // Privacy applies on the next poll; Discord restarts so it updates now
    // and drops any title lookup.
    async updatePrivacy(changes) {
      const next = await settingsStore.updatePrivacy(changes);
      current = next;
      resolveCard.invalidate();
      await discord.stop().catch(() => {});
      discord = launchDiscord(next);
    },
    // Card appearance (#94): the local card reads config.card on every
    // render, so a save shows on the next /card.svg request.
    async updateCard(changes) {
      current = await settingsStore.updateCard(changes);
    },
    // Preview for the settings page: what's playing now (privacy applied),
    // or a sample track when nothing is, so layout changes are visible.
    async previewCard(card) {
      let presence = null;
      try { presence = await cardProvider.getPresence(); } catch { presence = null; }
      if (!presence || presence.state === "idle") presence = applyPrivacy(PREVIEW_SAMPLE, privacyPolicyFromConfig(current));
      // A plain grey square stands in for artwork so placement and size
      // show in the preview; real art is fetched for /card.svg (#449).
      const svg = renderCard(presence, { ...cardRenderOptions(card), artworkDataUri: PREVIEW_ARTWORK });
      const automaticWidth = presence.kind === "track" ? 100 : 68;
      return svg.replace("<svg ", `<svg data-preview-artwork-width="${card.artworkWidth ?? automaticWidth}" `);
    },
    // Drops cached album art and updates Discord straight away (#154).
    refreshArtwork: () => discord.refreshArtwork(),
    // Servers (#253): adding or removing a server runs through setup. The
    // host (the Windows tray session) opens it and restarts the app after.
    ...(typeof requestSetup === "function" ? { openSetup: () => { requestSetup(); } } : {}),
    // Pairing token for the YouTube extension (#136): shown on the settings
    // page for pasting into the extension. Reset makes a new one and cuts
    // off the old extension.
    ...(youtube ? {
      youtubePairing: async () => ({ token: youtube.token }),
      async resetYouTubePairing() {
        const token = await resetYouTubePairingToken(credentialStore);
        youtube.bridge.setToken(token);
        youtube.token = token;
        return { token };
      },
    } : {}),
    async updateHosted(changes) {
      const next = await settingsStore.updateHosted(changes);
      current = next;
      await hosted.stop().catch(() => {});
      hosted = launchHosted(next);
    },
    async disconnectHosted() {
      const running = hosted;
      await running.stop().catch(() => {});
      hosted = offHosted;
      if (typeof running.disconnect === "function") await running.disconnect();
      else if (typeof hostedCredentials?.load === "function") await createHostedUploader({ baseUrl: current.hosted?.url ?? DEFAULT_HOSTED_URL, credentials: hostedCredentials, fetchImpl }).disconnect();
      if (current.hosted?.enabled) current = await settingsStore.updateHosted({ enabled: false });
    },
  });
  const statusHandler = createStatusPageHandler({ status, fallback: createCardHandler({ resolveCard, cacheControl: "no-store" }) });
  // The Logs page reads the app log (no log file, e.g. a dev checkout: empty).
  const logsHandler = createLogsPageHandler({ readEvents: () => readLogTail(logFile), fallback: statusHandler });
  // Hosted card devices on the settings page (#140).
  const devicesHandler = createHostedDevicesHandler({
    getClient: () => (typeof hostedCredentials?.load === "function" ? createHostedDevicesClient({ baseUrl: current.hosted?.url ?? DEFAULT_HOSTED_URL, credentials: hostedCredentials, fetchImpl }) : null),
    onSignedOut: () => settings.disconnectHosted(),
    fallback: logsHandler,
  });
  const services = typeof credentialStore.save === "function" ? createSettingsConnectedServices({ file: configFile, credentialStore, hostedCredentials, onConfigured, settingsStore, fetchImpl, ...(spotifySignIn ? { spotifySignIn } : {}), ...(hostedSignIn ? { hostedSignIn } : {}) }) : null;
  const management = deviceId && typeof credentialStore.save === "function"
    ? createSettingsServers({ file: configFile, credentialStore, deviceId, version: version ?? "0", onConfigured, fileQueue: settingsStore.serial, ...(discoverServers ? { discover: discoverServers } : {}), ...(signIn ? { signIn } : {}) })
    : null;
  const managementFallback = async (request) => (await services?.handler(request)) ?? (await management?.handler(request)) ?? devicesHandler(request);
  const pageHandler = createSettingsPageHandler({ settings, fallback: managementFallback });
  const handler = youtube ? createYouTubeBridgeHandler({ bridge: youtube.bridge, fallback: pageHandler }) : pageHandler;
  // Saves need the cookie the app's own pages set, so another local program
  // or web page can't change settings.
  // The bridge checks its own pairing token and extension origin, so it
  // skips the session check the settings pages use.
  const server = createServer({ host, port, handler, sessionSecret: randomBytes(32).toString("base64url"), openWritePaths: youtube ? [YOUTUBE_BRIDGE_PATH] : [] });
  let address;
  try {
    address = await server.listen();
  } catch (error) {
    if (error?.code === "EADDRINUSE") throw new StartupError("PORT_IN_USE", `Port ${port} is already in use. Close the other program using it and try again.`);
    // Reserved ports and OS permissions can reject a bind on any platform.
    if (error?.code === "EACCES") throw new StartupError("PORT_BLOCKED", `The OS won't let NowPlaying use port ${port}. Set NOWPLAYING_PORT to another port (1024 to 65535) and try again.`);
    throw new StartupError("SERVER_START_FAILED", "Couldn't start the local card server.");
  }
  const authority = address.family === "IPv6" ? `[${address.address}]` : address.address;
  discord = launchDiscord(config);
  status.setDiscord(() => discord.status === "on"
    ? { enabled: true, ...discord.connection() }
    : { enabled: discord.status !== "off", state: discord.status });
  hosted = launchHosted(config);
  status.setHosted(() => hosted.status === "on"
    ? { enabled: true, ...hosted.connection() }
    : { enabled: hosted.status !== "off", state: hosted.status });
  const close = async () => {
    await hosted.stop().catch(() => {});
    await discord.stop().catch(() => {});
    await server.close();
  };
  return Object.freeze({ config, servers: () => (multi ? multi.servers() : Object.freeze([])), url: `http://${authority}:${address.port}`, get discord() { return discord.status; }, get hosted() { return hosted.status; }, hostedCardUrl: () => hosted.cardUrl(), refreshArtwork: () => discord.refreshArtwork(), safeMode, status, close });
}

const PREVIEW_ARTWORK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPo6p8BAANYAbKMazHIAAAAAElFTkSuQmCC";
const PREVIEW_SAMPLE = Object.freeze({ state: "playing", kind: "track", title: "Sample track", subtitle: "Sample artist", positionMs: 83_000, durationMs: 214_000 });
const OFFLINE_PROVIDER = Object.freeze({ getPresence: async () => ({ state: "idle" }) });

async function createServersProvider(config, credentialStore, fetchImpl, providerBackoff) {
  const entries = [];
  // Album art for the local card (#449). Each server records the artwork refs
  // it returns so the card can fetch them with that server's sign-in; nothing
  // secret goes on the presence itself. Refs are matched by value because
  // presence normalising copies them. Each server has its own cache, since two
  // servers can use the same image path; if two report the very same ref, the
  // one polled last is used.
  const artworkSources = new Map();
  for (const [index, server] of config.servers.entries()) {
    try {
      const signedIn = await createSignedInProvider(server, credentialStore, fetchImpl);
      const artwork = createServerArtwork(server, signedIn.secret, fetchImpl);
      const tagged = { ...signedIn.provider, getPresence: async () => { const presence = await signedIn.provider.getPresence(); if (artwork && presence?.artwork && typeof presence.artwork === "object") { if (artworkSources.size >= 256) artworkSources.clear(); artworkSources.set(artworkRefKey(presence.artwork), artwork); } return presence; } };
      entries.push({ server, provider: withProviderBackoff(tagged, providerBackoff) });
    } catch (error) {
      if (index === 0) throw error;
      entries.push({ server, unavailable: error instanceof StartupError ? error.startupCode : "CONFIG_INVALID" });
    }
  }
  const multi = createMultiServerProvider(entries);
  const artwork = Object.freeze({
    // Artwork is a nice-to-have: any failure shows the card without it.
    async resolve(ref) {
      const source = ref && typeof ref === "object" ? artworkSources.get(artworkRefKey(ref)) : null;
      if (!source) return null;
      try { return await source.resolve(ref); } catch { return null; }
    },
  });
  return Object.freeze({ ...multi, artwork });
}

// Tint for the card background (#447): the art's average colour, worked out
// once per image. The renderer keeps it in a safe lightness range.
const tints = new Map();
async function tintFor(dataUri) {
  if (tints.has(dataUri)) return tints.get(dataUri);
  let tint = null;
  try {
    const { default: sharp } = await import("sharp");
    const { dominant } = await sharp(Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64")).stats();
    tint = `#${[dominant.r, dominant.g, dominant.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  } catch { tint = null; }
  if (tints.size >= 128) tints.delete(tints.keys().next().value);
  tints.set(dataUri, tint);
  return tint;
}

function artworkRefKey(ref) {
  return JSON.stringify([ref.provider ?? null, ref.type ?? null, ref.itemId ?? null, ref.imageId ?? null, ref.imageTag ?? null]);
}

function createServerArtwork(server, secret, fetchImpl) {
  let providerConfig;
  const baseUrl = server.serverUrl;
  if (server.provider === "plex") providerConfig = { baseUrl, token: secret };
  else if (server.provider === "jellyfin" || server.provider === "emby") providerConfig = { baseUrl, apiKey: secret };
  else if (server.provider === "navidrome") {
    try { const parts = JSON.parse(secret); providerConfig = { baseUrl, username: server.identity?.id, token: parts?.token, salt: parts?.salt }; } catch { return null; }
  } else return null;
  let service = null;
  return Object.freeze({
    async resolve(ref) {
      service ??= (async () => {
        const { createDefaultArtworkSanitizer } = await import("./artwork-sanitizer-runtime.js");
        return createArtworkService({ cache: createArtworkCache(), sanitizer: createDefaultArtworkSanitizer(), fetchImpl, timeoutMs: 3000 });
      })().catch((error) => { service = null; throw error; });
      const dataUri = await (await service).resolve(ref, providerConfig);
      if (!dataUri) return null;
      return { dataUri, tint: await tintFor(dataUri) };
    },
  });
}

async function createSignedInProvider(config, credentialStore, fetchImpl) {
  let secret;
  try {
    secret = await credentialStore.read(config.credentialRef);
  } catch {
    throw new StartupError("CREDENTIAL_READ_FAILED", "Couldn't read your saved sign-in from Windows Credential Manager. Run `nowplaying.exe setup` to sign in again.");
  }
  if (typeof secret !== "string" || !secret) throw credentialMissing();
  try {
    return { provider: createProviderFromConfig(config, secret, { fetchImpl }), secret };
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
