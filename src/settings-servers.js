// Server management for the browser UI. Sign-ins remain in the OS credential
// store; only validated provider identities and addresses enter config.json.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseAppConfig } from "./app-config.js";
import { MAX_SERVERS, serializeSetupConfig } from "./setup-config.js";
import { createSetupSignInHandler } from "./setup-signin-handler.js";
import { SignInError } from "./provider-signin.js";
import { discoverSettingsServers, subnetCandidates } from "./settings-discovery.js";

const SAFE = new Set(["same-origin", "none"]);
const PROVIDERS = new Set(["plex", "jellyfin", "emby", "navidrome"]);

export function createSettingsServers({ file, credentialStore, deviceId, version, onConfigured = async () => {}, discover = discoverSettingsServers, signIn, fileQueue, beforeRestart = async () => {} } = {}) {
  if (!file || typeof credentialStore?.save !== "function" || typeof credentialStore?.read !== "function") throw new TypeError("server management needs config file and credential store");
  let queue = Promise.resolve();
  let scan = null;
  let cached = null;
  let configured = false;
  let activationFailed = false;
  function scheduleRestart() {
    activationFailed = false;
    setTimeout(() => {
      Promise.resolve().then(() => onConfigured()).catch(() => { activationFailed = true; });
    }, 500);
  }
  function serial(job) {
    if (fileQueue) return fileQueue(job);
    const run = queue.then(job);
    queue = run.catch(() => {});
    return run;
  }
  async function read() {
    try { return parseAppConfig(await readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  async function save(servers, existing) {
    const body = serializeSetupConfig({
      servers, credentialStored: true,
      discordEnabled: existing?.discord?.enabled ?? true,
      discordIdleBehavior: existing?.discord?.idleBehavior ?? "clear",
      discordArtworkLookup: existing?.discord?.artworkLookup ?? "off",
      ...(existing?.discord?.timestamps ? { discordTimestamps: existing.discord.timestamps } : {}),
      ...(existing?.hosted ? { hostedEnabled: existing.hosted.enabled, ...(existing.hosted.url ? { hostedUrl: existing.hosted.url } : {}) } : {}),
      ...(existing?.privacy ? { privacy: existing.privacy } : {}),
      ...(existing?.card ? { card: existing.card } : {}),
      ...(existing?.spotify ? { spotify: { clientId: existing.spotify.clientId, identity: existing.spotify.identity } } : {}),
    });
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    try { await writeFile(temp, body, { mode: 0o600, flag: "wx" }); await rename(temp, file); }
    catch (error) { await rm(temp, { force: true }).catch(() => {}); throw error; }
  }
  const signin = createSetupSignInHandler({ credentialStore, deviceId, version, requireServerUrl: true, ...(signIn ? { signIn } : {}),
    beforeSignIn: async ({ provider, serverUrl }) => serial(async () => {
      const existing = await read();
      // At capacity allow reconnecting to an existing server address, then
      // check the returned identity before writing anything. A new address
      // fails here, before a Plex approval or a password exchange.
      if ((existing?.servers.length ?? 0) >= MAX_SERVERS && !existing.servers.some((s) => s.provider === provider && s.serverUrl === serverUrl)) {
        throw new SignInError("too_many_servers");
      }
    }),
    beforeSignedIn: async ({ provider, identity }) => serial(async () => {
      const existing = await read();
      if ((existing?.servers.length ?? 0) >= MAX_SERVERS && !existing.servers.some((s) => s.provider === provider && s.identity.id === identity.id)) {
        throw new SignInError("too_many_servers");
      }
    }),
    onSignedIn: async ({ provider, identity, serverUrl }) => serial(async () => {
      if (!PROVIDERS.has(provider) || !serverUrl) throw new TypeError("invalid server");
      const existing = await read();
      const servers = [...(existing?.servers ?? [])].map((s) => ({ provider: s.provider, serverUrl: s.serverUrl, identity: s.identity }));
      if (!servers.some((s) => s.provider === provider && s.identity.id === identity.id)) servers.push({ provider, serverUrl, identity });
      else {
        const i = servers.findIndex((s) => s.provider === provider && s.identity.id === identity.id);
        servers[i] = { provider, serverUrl, identity };
      }
      await save(servers, existing);
      await beforeRestart();
      configured = true;
      scheduleRestart();
    }),
  });
  async function handler(request = {}) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const method = request.method ?? "GET";
    if (!["/api/settings/servers", "/api/settings/servers/discover", "/api/settings/servers/cancel", "/api/setup/signin"].includes(url.pathname)) return null;
    if (url.pathname === "/api/setup/signin") {
      const site = request.headers?.["sec-fetch-site"];
      if (site !== undefined && !SAFE.has(String(site).toLowerCase())) return json(403, { error: "forbidden" });
      return signin(request);
    }
    const site = request.headers?.["sec-fetch-site"];
    if (site !== undefined && !SAFE.has(String(site).toLowerCase())) return json(403, { error: "forbidden" });
    if (url.pathname === "/api/settings/servers/discover") {
      if (method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
      if (scan) return json(409, { error: "scan_running" });
      let subnet;
      try { const input = JSON.parse(request.body ?? "{}"); if (!input || Object.keys(input).join() !== "subnet" || typeof input.subnet !== "string") throw Error(); subnet = subnetCandidates(input.subnet); }
      catch { return json(400, { error: "invalid_subnet" }); }
      const controller = new AbortController(); scan = controller;
      try {
        const found = await discover({ signal: controller.signal, hosts: subnet });
        if (controller.signal.aborted) return json(200, { cancelled: true });
        cached = found;
        return json(200, { servers: cached ?? [] });
      }
      catch { return controller.signal.aborted ? json(200, { cancelled: true }) : json(503, { error: "discovery_failed" }); }
      finally { if (scan === controller) scan = null; }
    }
    if (url.pathname === "/api/settings/servers/cancel") {
      if (method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
      scan?.abort();
      return json(200, { cancelled: Boolean(scan) });
    }
    if (method === "GET") {
      const config = await read();
      return json(200, { firstRun: !config, configured, activationFailed, servers: (config?.servers ?? []).map((s) => ({ provider: s.provider, id: s.identity.id, name: s.identity.displayName, baseUrl: s.serverUrl })), discovered: cached ?? [] });
    }
    if (method !== "DELETE") return json(405, { error: "method_not_allowed" }, { Allow: "GET, DELETE" });
    let input;
    try { input = JSON.parse(request.body ?? ""); } catch { return json(400, { error: "invalid_json" }); }
    if (!input || Object.keys(input).sort().join(",") !== "id,provider" || !PROVIDERS.has(input.provider) || typeof input.id !== "string") return json(400, { error: "invalid_server" });
    return serial(async () => {
      const existing = await read();
      if (!existing) return json(404, { error: "not_found" });
      const servers = existing.servers.filter((s) => !(s.provider === input.provider && s.identity.id === input.id));
      if (servers.length === existing.servers.length) return json(404, { error: "not_found" });
      if (!servers.length) return json(409, { error: "last_server" });
      try { await save(servers, existing); }
      catch { return json(500, { error: "save_failed" }); }
      scheduleRestart();
      return json(200, { removed: true });
    });
  }
  return { handler };
}
function json(status, value, extra = {}) { return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }, body: `${JSON.stringify(value)}\n` }; }
