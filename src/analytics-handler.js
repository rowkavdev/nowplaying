import { timingSafeEqual } from "node:crypto";

export function createAnalyticsHandler({ store, statsToken } = {}) {
  if (!store || typeof store.recordDiscord !== "function" || typeof store.stats !== "function") throw new TypeError("store: expected an analytics store");
  if (typeof statsToken !== "string" || statsToken.length < 24) throw new TypeError("statsToken: expected at least 24 characters");

  return async function handle(request) {
    const method = request?.method || "GET";
    const url = new URL(request?.url || "/", "http://localhost");
    if (url.pathname === "/stats") {
      if (method !== "GET") return response(405, "Method Not Allowed", { Allow: "GET" });
      if (!authorized(request?.headers, statsToken)) return response(401, "Unauthorized", { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" });
      return response(200, `${JSON.stringify(await store.stats())}\n`, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    }
    if (url.pathname === "/analytics/discord") {
      if (method !== "POST") return response(405, "Method Not Allowed", { Allow: "POST" });
      const installationId = readHeader(request?.headers, "x-nowplaying-installation");
      try { await store.recordDiscord(installationId); }
      catch { return response(400, "Invalid analytics event", { "Cache-Control": "no-store" }); }
      return response(204, "", { "Cache-Control": "no-store" });
    }
    return null;
  };
}

function authorized(headers, token) {
  const value = readHeader(headers, "authorization");
  if (!value?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(value.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function readHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((value) => value.toLowerCase() === name);
  return key ? headers[key] : undefined;
}
function response(status, body, headers = {}) { return Object.freeze({ status, body, headers: Object.freeze(headers) }); }
