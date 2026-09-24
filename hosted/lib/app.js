import { bearerToken, parseCardOptions, readJsonBody, requireMethod, sendCard, sendError, sendJson } from "./http.js";

// Framework-neutral request handlers so the same service runs on Vercel or a
// self-hosted Node server. `getService` is lazy so importing never needs env.
export function createHandlers({ getService }) {
  return {
    async register(req, res) {
      if (!requireMethod(req, res, ["POST"])) return;
      try {
        const clientKey = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
        const result = await getService().register({ clientKey });
        sendJson(res, 201, result);
      } catch (error) { sendError(res, error); }
    },
    async ingest(req, res) {
      if (!requireMethod(req, res, ["POST"])) return;
      try {
        const token = bearerToken(req);
        const payload = await readJsonBody(req);
        sendJson(res, 202, await getService().ingest({ token, payload }));
      } catch (error) { sendError(res, error); }
    },
    async revoke(req, res) {
      if (!requireMethod(req, res, ["POST", "DELETE"])) return;
      try { sendJson(res, 200, await getService().revoke({ token: bearerToken(req) })); }
      catch (error) { sendError(res, error); }
    },
    async card(req, res) {
      if (!requireMethod(req, res, ["GET", "HEAD"])) return;
      try {
        const url = new URL(req.url, "http://localhost");
        const options = parseCardOptions(url.searchParams);
        const id = url.searchParams.get("id") ?? /^\/card\/([^/]+)\.svg$/.exec(url.pathname)?.[1] ?? null;
        const presence = await getService().readCardState(id);
        sendCard(req, res, presence, options);
      } catch (error) { sendError(res, error); }
    },
    // Shields.io endpoint badge (https://shields.io/badges/endpoint-badge).
    async requestsBadge(req, res) {
      if (!requireMethod(req, res, ["GET", "HEAD"])) return;
      try {
        const count = await getService().readRequestCount();
        sendJson(res, 200, { schemaVersion: 1, label: "card requests", message: compactCount(count), color: "#58a6ff" }, { "cache-control": "public, max-age=300, s-maxage=300" });
      } catch {
        sendJson(res, 503, { schemaVersion: 1, label: "card requests", message: "unavailable", color: "lightgrey" });
      }
    },
    health(req, res) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end("ok");
    },
  };
}

// 999 -> "999", 12_345 -> "12.3k", 4_560_000 -> "4.56M".
export function compactCount(count) {
  let value = count;
  for (const unit of ["", "k", "M", "B"]) {
    const shown = unit === "" ? value : Number(value.toPrecision(3));
    if (shown < 1000 || unit === "B") return `${shown}${unit}`;
    value /= 1000;
  }
}
