// Finds media servers so the setup wizard can offer them first: HTTP probes
// on this PC and the LAN gateway, plus Jellyfin/Emby and Plex UDP discovery on the
// local network. Read-only, no credentials, short timeouts.

import { networkInterfaces as osNetworkInterfaces } from "node:os";
import { discoverLanServers } from "./setup-lan-discovery.js";
import { discoverPlexGdm } from "./setup-plex-gdm.js";

const MAX_BODY = 64 * 1024;
const HOST = "127.0.0.1";
const MAX_CONCURRENT = 4;
// Check likely gateway addresses by HTTP as well as loopback and UDP discovery.
const NETWORK_PORTS = Object.freeze([4533, 8096, 32400]);

export const DISCOVERY_PROBES = Object.freeze([
  Object.freeze({ port: 4533, path: "/rest/ping.view?f=json&v=1.16.1&c=nowplaying-setup", classify: classifySubsonic }),
  Object.freeze({ port: 8096, path: "/System/Info/Public", classify: classifyJellyfinOrEmby }),
  Object.freeze({ port: 32400, path: "/identity", classify: classifyPlex }),
]);

export async function discoverLocalServers({ fetchImpl = globalThis.fetch, timeoutMs = 1500, probes = DISCOVERY_PROBES, discoverLan = discoverLanServers, discoverPlex = discoverPlexGdm, networkHosts = gatewayCandidates(), concurrency = MAX_CONCURRENT, signal, onProbeFailure } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (signal?.aborted) return [];
  const jobs = probes.map((probe) => ({ host: HOST, probe }));
  for (const host of networkHosts) for (const probe of probes) if (NETWORK_PORTS.includes(probe.port)) jobs.push({ host, probe });
  const [results, lan, plex] = await Promise.all([
    runLimited(jobs, concurrency, ({ host, probe }) => runProbe(host, probe, fetchImpl, timeoutMs, signal, onProbeFailure), signal),
    typeof discoverLan === "function" ? discoverLan({ timeoutMs, signal }).catch(() => []) : [],
    typeof discoverPlex === "function" ? discoverPlex({ timeoutMs, signal }).catch(() => []) : [],
  ]);
  if (signal?.aborted) return [];
  const found = results.filter(Boolean);
  return mergeServers(found.filter((s) => s.baseUrl.startsWith(`http://${HOST}:`)), [...found.filter((s) => !s.baseUrl.startsWith(`http://${HOST}:`)), ...(Array.isArray(lan) ? lan : []), ...(Array.isArray(plex) ? plex : [])]);
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

async function runProbe(host, probe, fetchImpl, timeoutMs, signal, onProbeFailure) {
  const baseUrl = `http://${host}:${probe.port}`;
  const failed = (reason) => onProbeFailure?.({ provider: probe.port === 32400 ? "plex" : probe.port === 4533 ? "navidrome" : "jellyfin_or_emby", baseUrl, reason });
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${probe.path}`, { signal: controller.signal, redirect: "error", headers: { Accept: "application/json, application/xml;q=0.9" } });
    const declaredHeader = response.headers?.get?.("content-length");
    const declared = typeof declaredHeader === "string" && declaredHeader.trim() !== "" ? Number(declaredHeader) : NaN;
    if (Number.isFinite(declared) && declared > MAX_BODY) { failed("oversize"); return null; }
    // Bound the actual bytes as they arrive, even when the peer omits
    // Content-Length: cancel the stream at the cap instead of buffering it
    // all first (#745).
    const reader = response.body?.getReader?.();
    let text;
    if (reader) {
      const chunks = [];
      let bytes = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BODY) { await reader.cancel().catch(() => {}); failed("oversize"); return null; }
        chunks.push(part.value);
      }
      text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    } else {
      // No stream to cap: only buffer when the peer declared a size at or
      // under the cap. text() cannot be interrupted, so calling it on a
      // response with no trusted size would buffer unboundedly (#747). A
      // peer lying about its declared size is still caught after the fact.
      if (!Number.isFinite(declared)) { failed("oversize"); return null; }
      text = await response.text();
      if (Buffer.byteLength(text) > MAX_BODY) { failed("oversize"); return null; }
    }
    const found = probe.classify({ status: response.status, text });
    if (!found) { failed(response.status === 200 ? "unrecognized_response" : "http_status"); return null; }
    const id = cleanId(found.id);
    return Object.freeze({ provider: found.provider, baseUrl, version: cleanVersion(found.version), ...(id ? { id } : {}), ...(found.name ? { name: found.name } : {}) });
  } catch {
    failed(controller.signal.aborted ? "timeout" : "network_error");
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
  return { provider: "plex", version: /\bversion="([^"]+)"/.exec(text)?.[1], id: /\bmachineIdentifier="([^"]+)"/.exec(text)?.[1], name: "Plex Media Server" };
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
