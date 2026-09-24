import { isIP } from "node:net";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

// Opt-in policy for the local setup page: same-origin script, style, images and
// fetch only. No inline script, no framing, no third-party origins.
export const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);
export const SESSION_COOKIE = "nowplaying_session";
export const SESSION_HEADER = "x-nowplaying-session";

// openWritePaths (#136): exact paths whose writes skip the same-origin and
// session checks because the handler authenticates them itself (the YouTube
// extension bridge sends a pairing token from a browser-extension origin).
// They still must be JSON and within the body limit.
export function createHttpServer({ handler, host = "127.0.0.1", port = 47832, shutdownMs = 10000, maxBodyBytes = 16 * 1024, sessionSecret, openWritePaths = [] } = {}) {
  if (typeof handler !== "function") throw new TypeError("handler: expected a function");
  if (!isLoopbackHost(host)) throw new TypeError("host: expected a loopback address");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("port must be an integer from 0 to 65535");
  if (!Number.isInteger(shutdownMs) || shutdownMs < 1 || shutdownMs > 30000) throw new RangeError("shutdownMs must be an integer from 1 to 30000");
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 1024 * 1024) throw new RangeError("maxBodyBytes must be an integer from 1 to 1048576");
  if (sessionSecret !== undefined && (typeof sessionSecret !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(sessionSecret))) throw new TypeError("sessionSecret: expected 32+ URL-safe characters");
  if (!Array.isArray(openWritePaths) || openWritePaths.some((path) => typeof path !== "string" || !/^\/[a-z0-9/_-]+$/.test(path))) throw new TypeError("openWritePaths: expected exact paths");
  const openPaths = new Set(openWritePaths);
  const sessionCookie = sessionSecret ? `${SESSION_COOKIE}=${sessionSecret}; Path=/; HttpOnly; SameSite=Strict` : undefined;
  const server = createServer(async (request, response) => {
    if (!isLoopbackAuthority(request.headers.host)) {
      response.writeHead(421, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      response.end("Misdirected Request");
      return;
    }
    let body;
    if (BODY_METHODS.has(request.method)) {
      const rejection = openPaths.has(pathOf(request.url))
        ? requireJson(request.headers)
        : rejectUnsafeWrite(request.headers) ?? (sessionSecret && !hasSession(request.headers, sessionSecret) ? { status: 403, message: "Forbidden" } : null);
      if (rejection) {
        request.resume();
        response.writeHead(rejection.status, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", Connection: "close" });
        response.end(rejection.message);
        return;
      }
      body = await readBody(request, maxBodyBytes);
      if (body === null) {
        response.writeHead(413, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", Connection: "close" });
        response.end("Payload Too Large");
        return;
      }
    }
    try {
      const result = await handler({ method: request.method, url: request.url, headers: request.headers, ...(body !== undefined ? { body } : {}) });
      if (!result) {
        response.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }
      const page = isPage(result);
      response.writeHead(result.status, { ...result.headers, ...SECURITY_HEADERS, ...(page ? { "Content-Security-Policy": PAGE_CSP } : {}), ...(page && sessionCookie ? { "Set-Cookie": sessionCookie } : {}) });
      response.end(result.body);
    } catch {
      response.writeHead(500, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      response.end("Internal Server Error");
    }
  });
  return Object.freeze({
    server,
    async listen() { await new Promise((resolve, reject) => server.listen(port, host, resolve).once("error", reject)); return server.address(); },
    async close() {
      const timer = setTimeout(() => server.closeAllConnections(), shutdownMs);
      try { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
      finally { clearTimeout(timer); }
    },
  });
}

function isPage(result) {
  if (result.page !== true || result.status !== 200) return false;
  const key = Object.keys(result.headers ?? {}).find((name) => name.toLowerCase() === "content-type");
  return key !== undefined && String(result.headers[key]).split(";")[0].trim().toLowerCase() === "text/html";
}

// A state-changing request must prove it came from this install's own UI: the
// browser page carries the SameSite=Strict cookie set when the page loaded, and
// the native window sends the same secret as a header.
function hasSession(headers, secret) {
  const header = headers[SESSION_HEADER];
  if (typeof header === "string" && sameSecret(header, secret)) return true;
  const cookies = String(headers.cookie ?? "").split(";").map((part) => part.trim());
  return cookies.some((part) => part.startsWith(`${SESSION_COOKIE}=`) && sameSecret(part.slice(SESSION_COOKIE.length + 1), secret));
}

function sameSecret(value, secret) {
  const left = Buffer.from(value);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

function rejectUnsafeWrite(headers) {
  const fetchSite = headers["sec-fetch-site"];
  if (fetchSite !== undefined && !SAFE_FETCH_SITES.has(String(fetchSite).toLowerCase())) return { status: 403, message: "Forbidden" };
  const origin = headers.origin;
  if (origin !== undefined) {
    let url;
    try { url = new URL(origin); } catch { return { status: 403, message: "Forbidden" }; }
    if (url.protocol !== "http:" || url.host !== String(headers.host).toLowerCase() || !isLoopbackAuthority(url.host)) return { status: 403, message: "Forbidden" };
  }
  return requireJson(headers);
}

function requireJson(headers) {
  const type = String(headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { status: 415, message: "Unsupported Media Type" };
  return null;
}

function pathOf(url) {
  try { return new URL(url, "http://127.0.0.1").pathname; } catch { return null; }
}

function readBody(request, limit) {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    request.resume();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    request.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) { done = true; chunks.length = 0; request.resume(); resolve(null); return; }
      chunks.push(chunk);
    });
    request.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString("utf8")); } });
    request.on("error", () => { if (!done) { done = true; resolve(null); } });
  });
}

function isLoopbackHost(host) {
  if (host === "localhost") return true;
  const version = isIP(host);
  if (version === 4) return host.startsWith("127.");
  if (version === 6) return host === "::1" || host.toLowerCase() === "0:0:0:0:0:0:0:1";
  return false;
}

function isLoopbackAuthority(authority) {
  if (typeof authority !== "string" || !authority || /[\/?#@]/.test(authority)) return false;
  let url;
  try { url = new URL(`http://${authority}`); } catch { return false; }
  if (url.username || url.password || (url.port && !/^\d{1,5}$/.test(url.port))) return false;
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  return isLoopbackHost(host);
}
