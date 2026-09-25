// On-demand LAN discovery for the browser Settings page. Never scans public,
// VPN or large subnets, follows redirects, or sends credentials to a candidate.
import { networkInterfaces as osNetworkInterfaces } from "node:os";
import { classifyJellyfinOrEmby, classifyPlex, classifySubsonic, discoverLocalServers, mergeServers } from "./setup-discovery.js";

const PORTS = Object.freeze([
  { port: 32400, protocol: "http", path: "/identity", classify: classifyPlex },
  { port: 8096, protocol: "http", path: "/System/Info/Public", classify: classifyJellyfinOrEmby },
  { port: 8920, protocol: "https", path: "/System/Info/Public", classify: classifyJellyfinOrEmby },
  { port: 4533, protocol: "http", path: "/rest/ping.view?f=json&v=1.16.1&c=nowplaying", classify: classifySubsonic },
]);
const MAX_REPLY = 64 * 1024;

export function subnetCandidates(networkInterfaces = osNetworkInterfaces) {
  const segments = new Set();
  let interfaces;
  try { interfaces = networkInterfaces() ?? {}; } catch { return []; }
  for (const addresses of Object.values(interfaces)) for (const entry of addresses ?? []) {
    if (!entry || entry.internal || (entry.family !== "IPv4" && entry.family !== 4)) continue;
    const octets = String(entry.address).split(".").map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) continue;
    const [a, b, c] = octets;
    if (!(a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31)) continue;
    // Limit each interface to its local /24 even if the interface advertises a
    // larger netmask. No more than two segments and no more than 508 hosts.
    segments.add(`${a}.${b}.${c}`);
  }
  return [...segments].slice(0, 2).flatMap((prefix) => Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`));
}

export async function discoverSettingsServers({ fetchImpl = globalThis.fetch, localDiscover = discoverLocalServers, hosts = subnetCandidates(), signal, timeoutMs = 220, concurrency = 64 } = {}) {
  if (signal?.aborted) return [];
  if (typeof fetchImpl !== "function" || !Array.isArray(hosts) || hosts.length > 508 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new TypeError("invalid discovery options");
  const local = await localDiscover({ fetchImpl, timeoutMs: 1200 }).catch(() => []);
  if (signal?.aborted) return [];
  const jobs = hosts.filter((h) => isPrivateHost(h)).flatMap((host) => PORTS.map((probe) => ({ host, probe })));
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length && !signal?.aborted) {
      const job = jobs[next++];
      const found = await probeServer(job, fetchImpl, timeoutMs, signal);
      if (found) results.push(found);
    }
  }));
  return signal?.aborted ? [] : mergeServers(local, results);
}

function isPrivateHost(host) {
  if (typeof host !== "string" || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  const [a, b, c, d] = host.split(".").map(Number);
  return [a, b, c, d].every((n) => n >= 0 && n <= 255) && (a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31);
}

async function probeServer({ host, probe }, fetchImpl, timeoutMs, signal) {
  const baseUrl = `${probe.protocol}://${host}:${probe.port}`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${probe.path}`, { signal: controller.signal, redirect: "error", headers: { Accept: "application/json, application/xml;q=0.9" } });
    const size = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(size) && size > MAX_REPLY) return null;
    // Bound the actual bytes too, even when the peer omits Content-Length.
    const reader = response.body?.getReader?.();
    let text;
    if (reader) {
      const chunks = []; let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_REPLY) { await reader.cancel(); return null; }
        chunks.push(part.value);
      }
      text = Buffer.concat(chunks).toString("utf8");
    } else {
      text = await response.text();
      if (Buffer.byteLength(text) > MAX_REPLY) return null;
    }
    const found = probe.classify({ status: response.status, text });
    if (!found) return null;
    return { provider: found.provider, baseUrl, version: typeof found.version === "string" ? found.version.slice(0, 40) : null, ...(found.id && /^[\w-]{1,64}$/.test(found.id) ? { id: found.id } : {}) };
  } catch { return null; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
