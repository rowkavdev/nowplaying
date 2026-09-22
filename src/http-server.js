import { isIP } from "node:net";
import { createServer } from "node:http";

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

export function createHttpServer({ handler, host = "127.0.0.1", port = 3000, shutdownMs = 10000 } = {}) {
  if (typeof handler !== "function") throw new TypeError("handler: expected a function");
  if (!isLoopbackHost(host)) throw new TypeError("host: expected a loopback address");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("port must be an integer from 0 to 65535");
  if (!Number.isInteger(shutdownMs) || shutdownMs < 1 || shutdownMs > 30000) throw new RangeError("shutdownMs must be an integer from 1 to 30000");
  const server = createServer(async (request, response) => {
    try {
      const result = await handler({ method: request.method, url: request.url, headers: request.headers });
      response.writeHead(result.status, { ...SECURITY_HEADERS, ...result.headers });
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

function isLoopbackHost(host) {
  if (host === "localhost") return true;
  const version = isIP(host);
  if (version === 4) return host.startsWith("127.");
  if (version === 6) return host === "::1" || host.toLowerCase() === "0:0:0:0:0:0:0:1";
  return false;
}
