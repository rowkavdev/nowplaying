// Finds media servers running on this PC so the setup wizard can offer them
// first. Read-only, loopback-only, no credentials, short timeouts.

const MAX_BODY = 64 * 1024;
const HOST = "127.0.0.1";

export const DISCOVERY_PROBES = Object.freeze([
  Object.freeze({ port: 4533, path: "/rest/ping.view?f=json&v=1.16.1&c=nowplaying-setup", classify: classifySubsonic }),
  Object.freeze({ port: 8096, path: "/System/Info/Public", classify: classifyJellyfinOrEmby }),
  Object.freeze({ port: 32400, path: "/identity", classify: classifyPlex }),
]);

export async function discoverLocalServers({ fetchImpl = globalThis.fetch, timeoutMs = 1500, probes = DISCOVERY_PROBES } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const results = await Promise.all(probes.map((probe) => runProbe(probe, fetchImpl, timeoutMs)));
  return Object.freeze(results.filter(Boolean));
}

async function runProbe(probe, fetchImpl, timeoutMs) {
  const baseUrl = `http://${HOST}:${probe.port}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${probe.path}`, { signal: controller.signal, redirect: "error", headers: { Accept: "application/json, application/xml;q=0.9" } });
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY) return null;
    const text = await response.text();
    if (text.length > MAX_BODY) return null;
    const found = probe.classify({ status: response.status, text });
    return found ? Object.freeze({ provider: found.provider, baseUrl, version: cleanVersion(found.version) }) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function classifySubsonic({ text }) {
  const body = parseJson(text)?.["subsonic-response"];
  if (!body || typeof body !== "object") return null;
  if (String(body.type ?? "").toLowerCase() !== "navidrome") return null;
  return { provider: "navidrome", version: body.serverVersion };
}

export function classifyJellyfinOrEmby({ status, text }) {
  if (status !== 200) return null;
  const info = parseJson(text);
  if (!info || typeof info.Id !== "string" || typeof info.Version !== "string") return null;
  const product = String(info.ProductName ?? "").toLowerCase();
  if (product.includes("jellyfin")) return { provider: "jellyfin", version: info.Version };
  if (product.includes("emby") || !product) return { provider: "emby", version: info.Version };
  return null;
}

export function classifyPlex({ status, text }) {
  if (status !== 200 || !/<MediaContainer\b[^>]*\bmachineIdentifier="[^"]+"/.test(text)) return null;
  return { provider: "plex", version: /\bversion="([^"]+)"/.exec(text)?.[1] };
}

function parseJson(text) { try { return JSON.parse(text); } catch { return null; } }
function cleanVersion(value) { return typeof value === "string" && /^[0-9A-Za-z.+_-]{1,40}$/.test(value) ? value : null; }

export function createSetupDiscoveryHandler({ discover = discoverLocalServers, cacheMs = 5000, now = Date.now } = {}) {
  let cached = null;
  return async function handle(request = {}) {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== "/api/setup/discover") return null;
    if ((request.method || "GET") !== "GET") return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
    if (!cached || now() - cached.at > cacheMs) cached = { at: now(), servers: await discover() };
    return json(200, { servers: cached.servers });
  };
}

function json(status, value, extra = {}) {
  return Object.freeze({ status, headers: Object.freeze({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }), body: `${JSON.stringify(value)}\n` });
}
