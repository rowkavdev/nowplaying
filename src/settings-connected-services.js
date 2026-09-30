// Reuses the established setup sign-in handlers on the running WebUI server.
// Credentials never enter config.json; only account identity and host choice do.
import { readFile } from "node:fs/promises";
import { createSetupSpotifyHandler } from "./setup-spotify-handler.js";
import { createHostedGitHubSignIn } from "./hosted-signin.js";
import { createSetupHostedHandler } from "./setup-hosted-handler.js";
import { createAppSettingsStore } from "./app-settings.js";
import { parseAppConfig, hostedUploadSettings } from "./app-config.js";
import { DEFAULT_HOSTED_URL, normalizeHostedUrl } from "./hosted-uploader.js";

const SAFE = new Set(["same-origin", "none"]);
const ROUTE = "/api/settings/services";

export function createSettingsConnectedServices({ file, credentialStore, hostedCredentials, onConfigured = async () => {}, settingsStore, spotifySignIn, hostedSignIn, fetchImpl = fetch, elapsedNow = () => performance.now() } = {}) {
  if (!file || typeof credentialStore?.save !== "function") throw new TypeError("Spotify credential store required");
  const store = settingsStore ?? createAppSettingsStore({ file });
  // First-server persistence and staged-service changes use one queue. Provider
  // waits and cancellation stay outside it so they cannot deadlock the commit.
  let queue = Promise.resolve();
  function serial(job) {
    const run = queue.then(job);
    queue = run.catch(() => {});
    return run;
  }
  let pendingSpotify = null;
  let removingSpotify = false;
  let pendingHosted = null;
  let activeHostedFlow = null;
  async function current() {
    try { return parseAppConfig(await readFile(file, "utf8")); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  }
  const restart = () => setTimeout(() => { Promise.resolve(onConfigured()).catch(() => {}); }, 500);
  function saveSpotify(account) { return serial(async () => {
    const config = await current();
    if (!config) { pendingSpotify = account; return; }
    await store.updateSpotify(account);
    pendingSpotify = null;
    // The flow result is only returned on poll. Restarting here can destroy
    // the handler before the browser sees its signed-in result.
  }); }
  function saveHosted(url) { return serial(async () => {
    const config = await current();
    if (!config) { pendingHosted = url; return; }
    await store.updateHostedDestination({ enabled: true, url: url === DEFAULT_HOSTED_URL ? null : url });
    pendingHosted = null;
    restart();
  }); }
  const spotify = createSetupSpotifyHandler({ credentialStore, onSignedIn: saveSpotify, elapsedNow, ...(spotifySignIn ? { signIn: spotifySignIn } : {}) });
  const hosted = createSetupHostedHandler({ credentials: hostedCredentials, fetchImpl,
    settings: async () => hostedUploadSettings(await current()),
    createSignIn: options => {
      const owner = activeHostedFlow;
      const credentials = options.credentials;
      return (hostedSignIn ?? createHostedGitHubSignIn)({ ...options, credentials: {
        load: (...args) => credentials.load(...args),
        save: async (...args) => {
          if (activeHostedFlow !== owner) throw new Error("hosted sign-in superseded");
          // A credential commit and its destination update are one transaction:
          // do not replace this owner while its durable save is in progress.
          owner.committing = true;
          try { return await credentials.save(...args); }
          catch (error) { owner.committing = false; throw error; }
        },
      } });
    },
  });
  function afterFirstServer() { return serial(async () => {
    if (!pendingSpotify && !pendingHosted) return;
    if (pendingSpotify) { await store.updateSpotify(pendingSpotify); pendingSpotify = null; }
    if (pendingHosted) { await store.updateHostedDestination({ enabled: true, url: pendingHosted === DEFAULT_HOSTED_URL ? null : pendingHosted }); pendingHosted = null; }
  }); }
  async function handler(request = {}) {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (path !== ROUTE && path !== "/api/setup/spotify" && !path.startsWith("/api/setup/hosted/")) return null;
    const site = request.headers?.["sec-fetch-site"];
    if (site !== undefined && !SAFE.has(String(site).toLowerCase())) return json(403, { error: "forbidden" });
    if (path === "/api/setup/spotify") {
      if (removingSpotify && request.method === "POST") return json(409, { error: "disconnect_in_progress" });
      const result = await spotify(request);
      if (request.method === "POST" && result?.status === 200) {
        let input; try { input = JSON.parse(request.body ?? "{}"); } catch { input = {}; }
        if (input.action === "poll" && JSON.parse(result.body).status === "signed_in" && await current()) restart();
      }
      return result;
    }
    if (path.startsWith("/api/setup/hosted/")) {
      let owner = activeHostedFlow;
      if (path === "/api/setup/hosted/signin") {
        let input; try { input = JSON.parse(request.body ?? "{}"); } catch { input = {}; }
        if (owner?.committing && input.action === "poll") return json(200, { status: "pending" });
        if (input.action === "start") {
          if (owner && (owner.committing || elapsedNow() < owner.expiresAt)) return json(409, { error: "signin_in_progress" });
          // Ownership changes before the first await, invalidating old saves.
          owner = { url: null, expiresAt: elapsedNow() + 900_000, committing: false };
          activeHostedFlow = owner;
        }
      }
      let result;
      try { result = await hosted(request); }
      catch {
        if (activeHostedFlow !== owner) return json(200, { status: "superseded" });
        // An older concurrent poll may throw while this owner is saving.
        // Only a failed save releases its commit flag; unrelated poll errors
        // must not detach durable credentials from their destination update.
        if (owner?.committing) return json(200, { status: "pending" });
        if (path === "/api/setup/hosted/signin") activeHostedFlow = null;
        return json(500, { error: "hosted_save_failed" });
      }
      if (path === "/api/setup/hosted/signin") {
        if (activeHostedFlow !== owner) return json(200, { status: "superseded" });
        if (result?.status === 200) {
          const value = JSON.parse(result.body);
          // Polls already in flight must not release a durable commit either.
          if (owner?.committing && value.status !== "signed_in") return json(200, { status: "pending" });
          if (value.status === "signed_in") {
            try { await saveHosted(owner?.url ?? DEFAULT_HOSTED_URL); }
            catch { return json(500, { error: "hosted_save_failed" }); }
            finally { if (activeHostedFlow === owner) activeHostedFlow = null; }
          } else if (value.status === "started") {
            const seconds = Number(value.expiresIn);
            owner.expiresAt = elapsedNow() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 900_000);
            let input; try { input = JSON.parse(request.body ?? "{}"); } catch { input = {}; }
            owner.url = normalizeHostedUrl(input.url ?? DEFAULT_HOSTED_URL);
          } else if (value.status !== "pending") activeHostedFlow = null;
        } else if (!owner?.committing) activeHostedFlow = null;
      }
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
      if (removingSpotify) return json(409, { error: "disconnect_in_progress" });
      removingSpotify = true;
      try {
        await spotify.cancelPending();
        return await serial(async () => {
          const config = await current();
          if (config?.spotify) await store.updateSpotify(null);
          const disconnected = config?.spotify ?? pendingSpotify;
          pendingSpotify = null;
          // Remove the saved refresh token. Config is removed first, so a failed
          // keychain delete cannot make the app keep using it.
          let tokenRemoved = !disconnected;
          if (disconnected && typeof credentialStore.remove === "function") {
            try { tokenRemoved = await credentialStore.remove(disconnected.credentialRef ?? { provider: "spotify", identityId: disconnected.identity.id }); }
            catch { tokenRemoved = false; }
          }
          restart();
          return json(200, { removed: true, tokenRemoved });
        });
      } finally { removingSpotify = false; }
    }
    return json(400, { error: "invalid_request" });
  }
  // Prepare optional sections without reading/writing a missing config. Clear
  // only the staged snapshot actually committed, never a newer staged result.
  function prepareFirstServer(existing) {
    const spotify = pendingSpotify, hosted = pendingHosted;
    return {
      config: { ...existing, ...(spotify ? { spotify } : {}), ...(hosted ? { hosted: { enabled: true, url: hosted === DEFAULT_HOSTED_URL ? null : hosted } } : {}) },
      committed: () => { if (pendingSpotify === spotify) pendingSpotify = null; if (pendingHosted === hosted) pendingHosted = null; },
    };
  }
  return { handler, afterFirstServer, prepareFirstServer, serial };
}
function json(status, value) { return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: `${JSON.stringify(value)}\n` }; }
