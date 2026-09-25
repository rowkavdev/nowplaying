// Reuses the established setup sign-in handlers on the running WebUI server.
// Credentials never enter config.json; only account identity and host choice do.
import { readFile } from "node:fs/promises";
import { createSetupSpotifyHandler } from "./setup-spotify-handler.js";
import { createSetupHostedHandler } from "./setup-hosted-handler.js";
import { createAppSettingsStore } from "./app-settings.js";
import { parseAppConfig, hostedUploadSettings } from "./app-config.js";
import { DEFAULT_HOSTED_URL, normalizeHostedUrl } from "./hosted-uploader.js";

const SAFE = new Set(["same-origin", "none"]);
const ROUTE = "/api/settings/services";

export function createSettingsConnectedServices({ file, credentialStore, hostedCredentials, onConfigured = async () => {}, settingsStore, spotifySignIn, hostedSignIn, fetchImpl = fetch } = {}) {
  if (!file || typeof credentialStore?.save !== "function") throw new TypeError("Spotify credential store required");
  const store = settingsStore ?? createAppSettingsStore({ file });
  let pendingSpotify = null;
  let pendingHosted = null;
  let activeHostedUrl = null;
  let hostedSigningIn = false;
  async function current() {
    try { return parseAppConfig(await readFile(file, "utf8")); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  }
  const restart = () => setTimeout(() => { Promise.resolve(onConfigured()).catch(() => {}); }, 500);
  async function saveSpotify(account) {
    const config = await current();
    if (!config) { pendingSpotify = account; return; }
    await store.updateSpotify(account);
    pendingSpotify = null;
    // The flow result is only returned on poll. Restarting here can destroy
    // the handler before the browser sees its signed-in result.
  }
  async function saveHosted(url) {
    const config = await current();
    if (!config) { pendingHosted = url; return; }
    await store.updateHostedDestination({ enabled: true, url: url === DEFAULT_HOSTED_URL ? null : url });
    pendingHosted = null;
    restart();
  }
  const spotify = createSetupSpotifyHandler({ credentialStore, onSignedIn: saveSpotify, ...(spotifySignIn ? { signIn: spotifySignIn } : {}) });
  const hosted = createSetupHostedHandler({ credentials: hostedCredentials, fetchImpl,
    settings: async () => hostedUploadSettings(await current()),
    ...(hostedSignIn ? { createSignIn: hostedSignIn } : {}),
  });
  async function afterFirstServer() {
    if (!pendingSpotify && !pendingHosted) return;
    if (pendingSpotify) { await store.updateSpotify(pendingSpotify); pendingSpotify = null; }
    if (pendingHosted) { await store.updateHostedDestination({ enabled: true, url: pendingHosted === DEFAULT_HOSTED_URL ? null : pendingHosted }); pendingHosted = null; }
  }
  async function handler(request = {}) {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (path !== ROUTE && path !== "/api/setup/spotify" && !path.startsWith("/api/setup/hosted/")) return null;
    const site = request.headers?.["sec-fetch-site"];
    if (site !== undefined && !SAFE.has(String(site).toLowerCase())) return json(403, { error: "forbidden" });
    if (path === "/api/setup/spotify") {
      const result = await spotify(request);
      if (request.method === "POST" && result?.status === 200) {
        let input; try { input = JSON.parse(request.body ?? "{}"); } catch { input = {}; }
        if (input.action === "poll" && JSON.parse(result.body).status === "signed_in" && await current()) restart();
      }
      return result;
    }
    if (path.startsWith("/api/setup/hosted/")) {
      if (path === "/api/setup/hosted/signin") {
        let input; try { input = JSON.parse(request.body ?? "{}"); } catch { input = {}; }
        if (input.action === "start" && hostedSigningIn) return json(409, { error: "signin_in_progress" });
        if (input.action === "start") hostedSigningIn = true;
      }
      const result = await hosted(request);
      if (path === "/api/setup/hosted/signin" && result?.status === 200) {
        const value = JSON.parse(result.body);
        if (value.status === "signed_in") {
          hostedSigningIn = false;
          try { await saveHosted(activeHostedUrl ?? DEFAULT_HOSTED_URL); }
          catch { return json(500, { error: "hosted_save_failed" }); }
        } else if (value.status === "started") {
          // URL is validated by the existing hosted handler; retain it only
          // once start succeeded. It never contains a credential.
          let input; try { input = JSON.parse(request.body ?? "{}"); } catch { input = {}; }
          activeHostedUrl = normalizeHostedUrl(input.url ?? DEFAULT_HOSTED_URL);
        } else if (value.status !== "pending") { hostedSigningIn = false; activeHostedUrl = null; }
      } else if (path === "/api/setup/hosted/signin") hostedSigningIn = false;
      return result;
    }
    if ((request.method ?? "GET") === "GET") {
      const config = await current();
      const credentials = typeof hostedCredentials?.load === "function" ? await hostedCredentials.load().catch(() => null) : null;
      return json(200, { spotify: config?.spotify ? { clientId: config.spotify.clientId, name: config.spotify.identity.displayName } : pendingSpotify ? { clientId: pendingSpotify.clientId, name: pendingSpotify.identity.displayName } : null,
        hosted: { enabled: config?.hosted?.enabled === true || Boolean(pendingHosted), url: config?.hosted?.url ?? pendingHosted ?? DEFAULT_HOSTED_URL, login: credentials?.login ?? null } });
    }
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "GET, POST" });
    let input; try { input = JSON.parse(request.body ?? "{}"); } catch { return json(400, { error: "invalid_json" }); }
    if (input?.action === "remove-spotify" && Object.keys(input).length === 1) {
      const config = await current();
      if (config?.spotify) await store.updateSpotify(null);
      pendingSpotify = null;
      // Remove the saved refresh token. Config is removed first, so a failed
      // keychain delete cannot make the app keep using it.
      let tokenRemoved = !config?.spotify;
      if (config?.spotify && typeof credentialStore.remove === "function") {
        try { tokenRemoved = await credentialStore.remove(config.spotify.credentialRef); }
        catch { tokenRemoved = false; }
      }
      restart();
      return json(200, { removed: true, tokenRemoved });
    }
    return json(400, { error: "invalid_request" });
  }
  return { handler, afterFirstServer };
}
function json(status, value) { return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: `${JSON.stringify(value)}\n` }; }
