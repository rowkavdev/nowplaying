import { readFile } from "node:fs/promises";
import { createCardHandler } from "./http-handler.js";
import { createCardPipeline } from "./card-pipeline.js";
import { createHttpServer } from "./http-server.js";
import { createResilientCardResolver } from "./resilient-card.js";
import { createSetupConfig } from "./setup-config.js";
import { createEmbyProvider } from "./providers/emby.js";
import { createJellyfinProvider } from "./providers/jellyfin.js";
import { createNavidromeProvider } from "./providers/navidrome.js";
import { createPlexProvider } from "./providers/plex.js";
import { resolveDiscordClientId } from "./discord-app.js";
import { createDiscordClient } from "./discord-client.js";
import { createDiscordIpcClient } from "./discord-ipc.js";
import { createDiscordPresenceLoop } from "./discord-presence.js";
import { createDiscordRpcTransport } from "./discord-rpc.js";

// Runs nowplaying from the config the setup wizard writes (config.json). The
// file never holds a secret: the sign-in is read from the credential store by
// credentialRef at start-up.

const MAX_CONFIG_BYTES = 16 * 1024;
const CONFIG_KEYS = new Set(["version", "provider", "serverUrl", "identity", "credentialRef", "discord"]);

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
  let config;
  try {
    config = createSetupConfig({
      provider: parsed.provider,
      serverUrl: parsed.serverUrl,
      identity: parsed.identity,
      credentialStored: true,
      discordEnabled: parsed.discord?.enabled,
      discordIdleBehavior: parsed.discord?.idleBehavior,
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

export async function loadAppConfig(file) {
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
  const username = config.provider === "navidrome" ? config.identity.id : config.identity.displayName;
  return Object.freeze({ ...inner, getPresence: () => inner.getPresence({ username }) });
}

function defaultDiscordTransport(clientId) {
  return createDiscordRpcTransport({ clientId, createClient: async () => createDiscordIpcClient() });
}

// Discord runs only when setup turned it on and the build has an application
// ID. Discord not running is fine: the client retries in the background.
export function startDiscordFromConfig(config, provider, { env = process.env, createTransport = defaultDiscordTransport, intervalMs, now } = {}) {
  if (!config.discord?.enabled) return Object.freeze({ status: "off", stop: async () => {} });
  const clientId = resolveDiscordClientId({ env });
  if (!clientId) return Object.freeze({ status: "no_app_id", stop: async () => {} });
  const client = createDiscordClient({ transport: createTransport(clientId), ...(now ? { now } : {}) });
  const loop = createDiscordPresenceLoop({ getPresence: () => provider.getPresence(), client, idleBehavior: config.discord.idleBehavior, ...(intervalMs ? { intervalMs } : {}), ...(now ? { now } : {}) });
  loop.start();
  return Object.freeze({ status: "on", stop: () => loop.stop() });
}

export async function startAppFromConfig({ configFile, credentialStore, host = "127.0.0.1", port = 3000, fetchImpl = fetch, discord: discordOptions = {} } = {}) {
  if (typeof credentialStore?.read !== "function") throw new TypeError("credentialStore.read is required");
  const config = await loadAppConfig(configFile);
  let secret;
  try {
    secret = await credentialStore.read(config.credentialRef);
  } catch {
    throw new StartupError("CREDENTIAL_READ_FAILED", "Couldn't read your saved sign-in from Windows Credential Manager. Run `nowplaying.exe setup` to sign in again.");
  }
  if (typeof secret !== "string" || !secret) throw credentialMissing();
  let provider;
  try {
    provider = createProviderFromConfig(config, secret, { fetchImpl });
  } catch (error) {
    if (error instanceof StartupError) throw error;
    throw invalidConfig();
  }
  const resolveCard = createResilientCardResolver({ resolveCard: createCardPipeline({ provider }), diagnostics: true });
  const server = createHttpServer({ host, port, handler: createCardHandler({ resolveCard }) });
  let address;
  try {
    address = await server.listen();
  } catch (error) {
    if (error?.code === "EADDRINUSE") throw new StartupError("PORT_IN_USE", `Port ${port} is already in use. Close the other program using it and try again.`);
    throw new StartupError("SERVER_START_FAILED", "Couldn't start the local card server.");
  }
  const authority = address.family === "IPv6" ? `[${address.address}]` : address.address;
  let discord;
  try {
    discord = startDiscordFromConfig(config, provider, discordOptions);
  } catch {
    discord = Object.freeze({ status: "failed", stop: async () => {} });
  }
  const close = async () => {
    await discord.stop().catch(() => {});
    await server.close();
  };
  return Object.freeze({ config, url: `http://${authority}:${address.port}`, discord: discord.status, close });
}

function invalidConfig() {
  return new StartupError("CONFIG_INVALID", "The NowPlaying config is damaged or out of date. Run `nowplaying.exe setup` again.");
}

function credentialMissing() {
  return new StartupError("CREDENTIAL_MISSING", "Your saved sign-in is missing from Windows Credential Manager. Run `nowplaying.exe setup` to sign in again.");
}
