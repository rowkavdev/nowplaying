// Finds media servers so the setup wizard can offer them first: HTTP probes
// on this PC and the LAN gateway, plus Jellyfin/Emby UDP discovery on the
// local network. Read-only, no credentials, short timeouts.

import { networkInterfaces as osNetworkInterfaces } from "node:os";
import { discoverLanServers } from "./setup-lan-discovery.js";

const MAX_BODY = 64 * 1024;
const HOST = "127.0.0.1";
const MAX_CONCURRENT = 4;
// Servers with no broadcast discovery are looked for on the LAN at these ports.
const NETWORK_PORTS = Object.freeze([4533, 8096]);

export const DISCOVERY_PROBES = Object.freeze([
  Object.freeze({ port: 4533, path: "/rest/ping.view?f=json&v=1.16.1&c=nowplaying-setup", classify: classifySubsonic }),
  Object.freeze({ port: 8096, path: "/System/Info/Public", classify: classifyJellyfinOrEmby }),
  Object.freeze({ port: 32400, path: "/identity", classify: classifyPlex }),
]);

export async function discoverLocalServers({ fetchImpl = globalThis.fetch, timeoutMs = 1500, probes = DISCOVERY_PROBES, discoverLan = discoverLanServers, networkHosts = gatewayCandidates(), concurrency = MAX_CONCURRENT, signal } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (signal?.aborted) return [];
  const jobs = probes.map((probe) => ({ host: HOST, probe }));
  for (const host of networkHosts) for (const probe of probes) if (NETWORK_PORTS.includes(probe.port)) jobs.push({ host, probe });
  const [results, lan] = await Promise.all([
    runLimited(jobs, concurrency, ({ host, probe }) => runProbe(host, probe, fetchImpl, timeoutMs, signal), signal),
    typeof discoverLan === "function" ? discoverLan({ timeoutMs, signal }).catch(() => []) : [],
  ]);
  if (signal?.aborted) return [];
  const found = results.filter(Boolean);
  return mergeServers(found.filter((s) => s.baseUrl.startsWith(`http://${HOST}:`)), [...found.filter((s) => !s.baseUrl.startsWith(`http://${HOST}:`)), ...(Array.isArray(lan) ? lan : [])]);
}

// Likely gateway addresses (x.y.z.1) of this PC's private IPv4 networks,
// worked out from the interface list so no command window ever opens.
export function gatewayCandidates(networkInterfaces = osNetworkInterfaces) {
  const hosts = new Set();
  let list = {};
  try { list = networkInterfaces() ?? {}; } catch { return []; }
  for (const addresses of Object.values(list)) {
    for (const entry of addresses ?? []) {
      if (!entry || entry.internal || (entry.family !== "IPv4" && entry.family !== 4)) continue;
      const parts = String(entry.address).split(".").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255) || !isPrivate(parts)) continue;
      const gateway = `${parts[0]}.${parts[1]}.${parts[2]}.1`;
      if (gateway !== entry.address) hosts.add(gateway);
    }
  }
  return [...hosts].slice(0, 4);
}

function isPrivate([a, b]) { return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); }

async function runLimited(items, limit, worker, signal) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !signal?.aborted) { const i = next++; results[i] = await worker(items[i]); }
  });
  await Promise.all(lanes);
  return results;
}

// Loopback results win; a LAN reply for a server already found on this PC
// (same provider and server id) is dropped so the list has no duplicates.
export function mergeServers(local, lan) {
  const merged = [...local];
  const seenIds = new Set(local.filter((s) => s.id).map((s) => `${s.provider}:${s.id}`));
  const seenUrls = new Set(local.map((s) => s.baseUrl));
  for (const server of Array.isArray(lan) ? lan : []) {
    const key = server.id ? `${server.provider}:${server.id}` : null;
    if ((key && seenIds.has(key)) || seenUrls.has(server.baseUrl)) continue;
    if (key) seenIds.add(key);
    seenUrls.add(server.baseUrl);
    merged.push(server);
  }
  return Object.freeze(merged);
}

async function runProbe(host, probe, fetchImpl, timeoutMs, signal) {
  const baseUrl = `http://${host}:${probe.port}`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${probe.path}`, { signal: controller.signal, redirect: "error", headers: { Accept: "application/json, application/xml;q=0.9" } });
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY) return null;
    const text = await response.text();
    if (text.length > MAX_BODY) return null;
    const found = probe.classify({ status: response.status, text });
    if (!found) return null;
    const id = cleanId(found.id);
    return Object.freeze({ provider: found.provider, baseUrl, version: cleanVersion(found.version), ...(id ? { id } : {}) });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
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
  if (product.includes("jellyfin")) return { provider: "jellyfin", version: info.Version, id: info.Id };
  if (product.includes("emby") || !product) return { provider: "emby", version: info.Version, id: info.Id };
  return null;
}

export function classifyPlex({ status, text }) {
  if (status !== 200 || !/<MediaContainer\b[^>]*\bmachineIdentifier="[^"]+"/.test(text)) return null;
  return { provider: "plex", version: /\bversion="([^"]+)"/.exec(text)?.[1] };
}

function parseJson(text) { try { return JSON.parse(text); } catch { return null; } }
export function cleanId(value) { return typeof value === "string" && /^[0-9A-Za-z-]{1,64}$/.test(value) ? value : null; }
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
