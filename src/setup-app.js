import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, win32 } from "node:path";
import { createHttpServer } from "./http-server.js";
import { createSetupDraftHandler } from "./setup-draft-handler.js";
import { createSetupDraftStore } from "./setup-draft-store.js";
import { createSetupPageHandler } from "./setup-page-handler.js";
import { createSetupDiscoveryHandler } from "./setup-discovery.js";
import { createSetupSignInHandler } from "./setup-signin-handler.js";
import { createSetupTestHandler } from "./setup-test-handler.js";
import { createSetupSpotifyHandler } from "./setup-spotify-handler.js";
import { serializeSetupConfig } from "./setup-config.js";
import { setupAccounts } from "./setup.js";

export function windowsSetupDraftPath({ localAppData, appName = "nowplaying" } = {}) {
  if (typeof localAppData !== "string" || !localAppData.trim()) throw new TypeError("LOCALAPPDATA is required");
  if (!/^[A-Za-z0-9._-]+$/.test(appName)) throw new TypeError("appName is invalid");
  return win32.join(win32.resolve(localAppData), appName, "setup-draft.json");
}

export function windowsConfigPath({ localAppData, appName = "nowplaying" } = {}) {
  return win32.join(win32.dirname(windowsSetupDraftPath({ localAppData, appName })), "config.json");
}

// Writes the finished setup as the app config: atomic, owner-only, and built by
// createSetupConfig, which refuses anything that looks like a credential.
export async function writeSetupConfig(file, draft) {
  if (!draft?.account) throw new TypeError("setup is not signed in");
  // Every server signed in during setup (#252), oldest first.
  const servers = setupAccounts(draft).map((account) => ({
    provider: account.provider,
    ...(account.serverUrl ? { serverUrl: account.serverUrl } : {}),
    identity: { id: account.id, displayName: account.displayName },
  }));
  const body = serializeSetupConfig({
    servers,
    credentialStored: true,
    discordEnabled: draft.discordEnabled,
    discordIdleBehavior: draft.discordIdleBehavior,
    discordArtworkLookup: draft.discordArtworkLookup === false ? "off" : "musicbrainz",
    ...(draft.spotify ? { spotify: { clientId: draft.spotify.clientId, identity: draft.spotify.identity } } : {}),
  });
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

// A random per-install id that providers see as the device (Plex client id,
// Jellyfin/Emby DeviceId). It is not secret, but it must stay stable so the
// server shows one "nowplaying" device instead of a new one per sign-in.
export async function loadOrCreateDeviceId(file, { random = () => randomBytes(16).toString("hex") } = {}) {
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (/^[A-Za-z0-9_-]{8,128}$/.test(existing)) return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const id = random();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${id}\n`, { encoding: "utf8", mode: 0o600 });
  return id;
}

// Starts the first-run wizard on a loopback-only port and returns its URL.
// Port 0 lets the OS pick a free port so a busy app port never blocks setup.
// `startup` (optional) manages "Start with Windows": { isEnabled(), setEnabled(bool) }.
// Without it the wizard doesn't offer the choice.
export async function startSetupApp({ draftFile, configFile, host = "127.0.0.1", port = 0, discover, credentialStore, deviceId, version, signIn: signInApi, spotifySignIn, startup, fetchImpl } = {}) {
  if (startup !== undefined && (typeof startup?.isEnabled !== "function" || typeof startup?.setEnabled !== "function")) throw new TypeError("startup is invalid");
  const page = createSetupPageHandler();
  const store = withStartupState(createSetupDraftStore({ file: draftFile }), startup);
  // Sign-in is only offered when a credential store is supplied, so a secret
  // can never be obtained without somewhere safe to put it. Without one the
  // wizard skips the sign-in step.
  // Finish writes the real config only when there is a signed-in account to
  // point it at; without a credential store there is nothing to run from yet.
  const writeConfig = configFile && credentialStore;
  const onFinish = writeConfig || startup ? async (finished) => {
    if (writeConfig) await writeSetupConfig(configFile, finished);
    if (startup && typeof finished.startWithWindows === "boolean") await startup.setEnabled(finished.startWithWindows);
  } : undefined;
  const draft = createSetupDraftHandler({ store, signIn: Boolean(credentialStore), ...(onFinish ? { onFinish } : {}) });
  const discovery = createSetupDiscoveryHandler(discover ? { discover } : {});
  // A successful sign-in records who signed in on the draft (never the secret).
  const onSignedIn = async ({ provider, identity, serverUrl }) => {
    const { draft: current } = await store.load();
    await store.save({ ...current, provider, account: { provider, id: identity.id, displayName: identity.displayName, ...(serverUrl ? { serverUrl } : {}) } });
  };
  const signIn = credentialStore
    ? createSetupSignInHandler({ credentialStore, deviceId, version, onSignedIn, ...(signInApi ? { signIn: signInApi } : {}) })
    : async () => null;
  // Optional Spotify sign-in for the card (#135); like the media server
  // sign-in it needs somewhere safe to keep the refresh token.
  const onSpotifySignedIn = async ({ clientId, identity }) => {
    const { draft: current } = await store.load();
    await store.save({ ...current, spotify: { clientId, identity } });
  };
  const spotify = credentialStore
    ? createSetupSpotifyHandler({ credentialStore, onSignedIn: onSpotifySignedIn, ...(spotifySignIn ? { signIn: spotifySignIn } : {}) })
    : async () => null;
  // "Test connection" needs the saved sign-in, so it exists only with a credential store.
  const connectionTest = credentialStore?.read
    ? createSetupTestHandler({ store, credentialStore, ...(fetchImpl ? { fetchImpl } : {}) })
    : async () => null;
  // Per-run secret: the browser page gets it as a SameSite=Strict cookie, the
  // native window gets it through its environment. Other local sites get neither.
  const sessionSecret = randomBytes(32).toString("base64url");
  const app = createHttpServer({ host, port, sessionSecret, handler: async (request) => (await page(request)) ?? (await discovery(request)) ?? (await signIn(request)) ?? (await spotify(request)) ?? (await connectionTest(request)) ?? (await draft(request)) });
  const address = await app.listen();
  const authority = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return Object.freeze({ url: `http://${authority}:${address.port}/setup`, sessionSecret, close: () => app.close() });
}

// Until the user chooses, the "Start with Windows" box shows what is set now
// (the installer may already have added the startup shortcut).
function withStartupState(store, startup) {
  if (!startup) return store;
  return Object.freeze({
    ...store,
    async load() {
      const loaded = await store.load();
      if (loaded.draft.startWithWindows !== null) return loaded;
      let enabled = false;
      try { enabled = await startup.isEnabled(); } catch { enabled = false; }
      return { ...loaded, draft: Object.freeze({ ...loaded.draft, startWithWindows: enabled }) };
    },
  });
}

// Opens a loopback setup URL in the default browser without a shell, so the URL
// can never be interpreted as a command.
function loopbackSetupUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/setup" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new TypeError("setup URL must be a loopback /setup URL");
  }
  return parsed;
}

export function openSetupUrl(url, { platform = process.platform, spawnProcess = spawn } = {}) {
  const parsed = loopbackSetupUrl(url);
  const [command, args] = platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", parsed.href]]
    : platform === "darwin" ? ["open", [parsed.href]]
    : ["xdg-open", [parsed.href]];
  const child = spawnProcess(command, args, { detached: true, stdio: "ignore", shell: false, windowsHide: true });
  child.on?.("error", () => {});
  child.unref?.();
  return parsed.href;
}

// Runs the native Windows setup window (scripts/windows-setup.ps1) against the
// local setup server and resolves with its exit code. Rejects if PowerShell
// cannot be started, so the caller can fall back to the browser page.
export function runNativeSetup(url, { scriptPath, sessionSecret, env = process.env, selfTest = false, visibilityProbe = false, probeWithoutShowFix = false, spawnProcess = spawn } = {}) {
  const parsed = loopbackSetupUrl(url);
  if (parsed.hostname !== "127.0.0.1") throw new TypeError("native setup needs a 127.0.0.1 URL");
  if (typeof scriptPath !== "string" || !scriptPath.endsWith("windows-setup.ps1")) throw new TypeError("scriptPath must point at windows-setup.ps1");
  if (sessionSecret !== undefined && (typeof sessionSecret !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(sessionSecret))) throw new TypeError("sessionSecret is invalid");
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-File", scriptPath, "-Url", parsed.href];
  if (selfTest) args.push("-SelfTest");
  if (visibilityProbe) args.push("-VisibilityProbe");
  if (visibilityProbe && probeWithoutShowFix) args.push("-ProbeWithoutShowFix");
  const piped = selfTest || visibilityProbe;
  return new Promise((resolve, reject) => {
    // The secret goes through the environment, not argv, so it never shows up
    // in process listings.
    const childEnv = sessionSecret ? { ...env, NOWPLAYING_SETUP_SESSION: sessionSecret } : env;
    const child = spawnProcess("powershell.exe", args, { shell: false, windowsHide: true, env: childEnv, stdio: piped ? ["ignore", "pipe", "pipe"] : "ignore" });
    let output = "";
    let errors = "";
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.stderr?.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output, errors }));
  });
}
