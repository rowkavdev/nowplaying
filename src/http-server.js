import { createServer } from "node:http";

export function createHttpServer({ handler, host = "127.0.0.1", port = 3000, shutdownMs = 10000 } = {}) {
  if (typeof handler !== "function") throw new TypeError("handler: expected a function");
  if (typeof host !== "string" || !host) throw new TypeError("host: expected a non-empty string");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("port must be an integer from 0 to 65535");
  if (!Number.isInteger(shutdownMs) || shutdownMs < 1 || shutdownMs > 30000) throw new RangeError("shutdownMs must be an integer from 1 to 30000");
  const server = createServer(async (request, response) => {
    try {
      const result = await handler({ method: request.method, url: request.url, headers: request.headers });
      response.writeHead(result.status, result.headers);
      response.end(result.body);
    } catch {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
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
