// Plex GDM discovery supplements the HTTP /identity probes, especially when
// the server is not on this PC or a guessed gateway. Never trusts a reply's
// Host header: the address is the UDP sender, with a validated Plex port.
import { createSocket } from "node:dgram";

const MESSAGE = Buffer.from("M-SEARCH * HTTP/1.0\r\n\r\n", "ascii");
const MAX_REPLY = 4 * 1024;
const MAX_SERVERS = 32;
const ENDPOINTS = Object.freeze([
  Object.freeze({ address: "255.255.255.255", port: 32410 }),
  Object.freeze({ address: "239.0.0.250", port: 32414 }),
]);

export function parsePlexGdmReply(buffer, address) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_REPLY || !isLocalIPv4(address)) return null;
  const text = buffer.toString("utf8");
  if (!/^(?:HTTP\/1\.[01] 200\b|HELLO \* HTTP\/1\.[01])/i.test(text)) return null;
  const fields = new Map();
  for (const line of text.split(/\r?\n/).slice(1, 32)) {
    const colon = line.indexOf(":");
    if (colon > 0) fields.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  if (fields.get("content-type")?.toLowerCase() !== "plex/media-server") return null;
  const port = Number(fields.get("port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const id = fields.get("resource-identifier");
  if (!id || !/^[\w-]{1,64}$/.test(id)) return null;
  const rawName = fields.get("name");
  const name = typeof rawName === "string" ? rawName.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 64) : "";
  const rawVersion = fields.get("version");
  const version = typeof rawVersion === "string" && /^[\w.+-]{1,40}$/.test(rawVersion) ? rawVersion : null;
  return Object.freeze({ provider: "plex", baseUrl: `http://${address}:${port}`, version, id, ...(name ? { name } : {}) });
}

function isLocalIPv4(address) {
  if (typeof address !== "string" || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) return false;
  const [a, b, c, d] = address.split(".").map(Number);
  return [a, b, c, d].every((n) => n >= 0 && n <= 255) &&
    (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
}

export async function discoverPlexGdm({ timeoutMs = 1500, endpoints = ENDPOINTS, socketFactory = () => createSocket("udp4"), signal } = {}) {
  if (signal?.aborted) return [];
  const servers = new Map();
  let socket;
  try { socket = socketFactory(); } catch { return []; }
  return new Promise((resolve) => {
    let timer;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      try { socket.close(); } catch { /* already closed */ }
      resolve(signal?.aborted ? [] : [...servers.values()]);
    };
    signal?.addEventListener("abort", finish, { once: true });
    socket.on("error", finish);
    if (signal?.aborted) { finish(); return; }
    socket.on("message", (message, info) => {
      if (finished || servers.size >= MAX_SERVERS) return;
      const server = parsePlexGdmReply(message, info.address);
      if (server) servers.set(server.id, server);
    });
    timer = setTimeout(finish, timeoutMs);
    try {
      socket.bind(0, () => {
        if (finished) return;
        for (const { address, port } of endpoints) {
          try {
            if (address === "255.255.255.255") socket.setBroadcast(true);
            socket.send(MESSAGE, port, address, () => {});
          } catch { /* some interfaces reject multicast/broadcast */ }
        }
      });
    } catch { finish(); }
  });
}
