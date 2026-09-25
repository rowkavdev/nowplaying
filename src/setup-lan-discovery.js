// Finds Jellyfin and Emby servers on the local network with their UDP
// discovery protocol: broadcast a "Who is ...Server?" probe to port 7359 and
// read the JSON replies. Read-only, no credentials, short timeout.

import { createSocket } from "node:dgram";

export const LAN_DISCOVERY_PORT = 7359;
export const LAN_PROBES = Object.freeze([
  Object.freeze({ provider: "jellyfin", message: "Who is JellyfinServer?" }),
  Object.freeze({ provider: "emby", message: "who is EmbyServer?" }),
]);

const MAX_REPLY = 4 * 1024;
const MAX_SERVERS = 32;

export async function discoverLanServers({ timeoutMs = 1500, broadcastAddress = "255.255.255.255", port = LAN_DISCOVERY_PORT, probes = LAN_PROBES, socketFactory = () => createSocket({ type: "udp4", reuseAddr: true }), signal } = {}) {
  if (signal?.aborted) return Object.freeze([]);
  const found = new Map();
  const sockets = [];
  const listen = (probe) => new Promise((resolve) => {
    let socket;
    try { socket = socketFactory(); } catch { resolve(); return; }
    sockets.push(socket);
    if (signal?.aborted) { socket.close(); resolve(); return; }
    socket.on("error", () => resolve());
    socket.on("message", (buffer) => {
      if (found.size >= MAX_SERVERS) return;
      const server = parseDiscoveryReply(buffer, probe.provider);
      if (server && !found.has(server.baseUrl)) found.set(server.baseUrl, server);
    });
    socket.bind(0, () => {
      if (signal?.aborted) { resolve(); return; }
      try {
        socket.setBroadcast(true);
        socket.send(Buffer.from(probe.message, "utf8"), port, broadcastAddress, () => resolve());
      } catch { resolve(); }
    });
  });
  const abort = () => { for (const socket of sockets) { try { socket.close(); } catch { /* already closed */ } } };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await Promise.all(probes.map(listen));
    if (!signal?.aborted) await new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      function done() { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); }
      signal?.addEventListener("abort", done, { once: true });
    });
  } finally {
    signal?.removeEventListener("abort", abort);
    for (const socket of sockets) { try { socket.close(); } catch { /* already closed */ } }
  }
  return Object.freeze(signal?.aborted ? [] : [...found.values()]);
}

export function parseDiscoveryReply(buffer, provider) {
  if (!buffer || buffer.length === 0 || buffer.length > MAX_REPLY) return null;
  let reply;
  try { reply = JSON.parse(buffer.toString("utf8")); } catch { return null; }
  if (!reply || typeof reply !== "object" || typeof reply.Id !== "string" || !reply.Id) return null;
  const baseUrl = cleanBaseUrl(reply.Address);
  if (!baseUrl) return null;
  const id = /^[0-9A-Za-z-]{1,64}$/.test(reply.Id) ? reply.Id : null;
  if (!id) return null;
  return Object.freeze({ provider, baseUrl, version: null, id, name: cleanName(reply.Name) });
}

function cleanBaseUrl(value) {
  if (typeof value !== "string" || value.length > 200) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

function cleanName(value) {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 64);
  return name || null;
}
