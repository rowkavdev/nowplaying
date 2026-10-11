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
    // GitHub sign-in (#140): the body carries a GitHub user token that the
    // service checks once with GitHub and never stores.
    async signInGitHub(req, res) {
      if (!requireMethod(req, res, ["POST"])) return;
      try {
        const clientKey = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
        const body = await readJsonBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !["githubToken", "deviceName", "legacyToken", "previousToken"].includes(k))) {
          return sendJson(res, 400, { error: "invalid_request" });
        }
        sendJson(res, 201, await getService().signInWithGitHub({ ...body, clientKey }));
      } catch (error) { sendError(res, error); }
    },
    // GET lists this user's PCs; POST { action: "rename" | "remove" | "remove-all", deviceId?, name? }.
    async devices(req, res) {
      if (!requireMethod(req, res, ["GET", "POST"])) return;
      try {
        const token = bearerToken(req);
        if (req.method === "GET") return sendJson(res, 200, await getService().listDevices({ token }));
        const body = await readJsonBody(req);
        const service = getService();
        switch (body?.action) {
          case "rename": return sendJson(res, 200, await service.renameDevice({ token, deviceId: body.deviceId, name: body.name }));
          case "remove": return sendJson(res, 200, await service.removeDevice({ token, deviceId: body.deviceId }));
          case "remove-all": return sendJson(res, 200, await service.signOutEverywhere({ token }));
          default: return sendJson(res, 400, { error: "invalid_request" });
        }
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
        const login = url.searchParams.get("user") ?? /^\/u\/([^/]+)\.svg$/.exec(url.pathname)?.[1] ?? null;
        const id = url.searchParams.get("id") ?? /^\/card\/([^/]+)\.svg$/.exec(url.pathname)?.[1] ?? null;
        const presence = login !== null ? await getService().readUserCardState(login) : await getService().readCardState(id);
        sendCard(req, res, presence, options);
      } catch (error) { sendError(res, error); }
    },
    // Shields.io endpoint badges (https://shields.io/badges/endpoint-badge).
    // Each publishes one aggregate total; the privacy rules in
    // docs/hosted-upload.md keep these free of anything per user or device.
    async requestsBadge(req, res) {
      return badgeHandler(req, res, "card requests", () => getService().readRequestCount());
    },
    async pcsBadge(req, res) {
      return badgeHandler(req, res, "PCs registered", () => getService().readRegistrationCount());
    },
    async usersBadge(req, res) {
      return badgeHandler(req, res, "people signed in", () => getService().readUserCount());
    },
    // Content badges: what is playing now or was played last, filtered by
    // media kind. Query: ?id=<cardId> or ?user=<login>, optional
    // ?kind=track|episode|movie|show|unknown (default any).
    async nowBadge(req, res) {
      return contentBadgeHandler(req, res, { last: false, getService });
    },
    async lastBadge(req, res) {
      return contentBadgeHandler(req, res, { last: true, getService });
    },
    health(req, res) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end("ok");
    },
  };
}

// Content badge responses refresh faster than the aggregate counters, so a
// finished track does not linger for five minutes.
const CONTENT_BADGE_CACHE = { "cache-control": "public, max-age=60, s-maxage=60" };

function contentBadgeLabel(kind, last) {
  if (last) {
    if (kind === "track") return "last listened";
    if (kind === "movie" || kind === "episode" || kind === "show") return "last watched";
    return "last played";
  }
  if (kind === "track") return "listening to";
  if (kind === "movie" || kind === "episode" || kind === "show") return "watching";
  return "now playing";
}

// One Shields endpoint badge showing the media text. Nothing renders without
// a title: an idle card reads "not playing" in grey.
async function contentBadgeHandler(req, res, { last, getService }) {
  if (!requireMethod(req, res, ["GET", "HEAD"])) return;
  try {
    const url = new URL(req.url, "http://localhost");
    const login = url.searchParams.get("user");
    const id = url.searchParams.get("id");
    if (login == null && id == null) return sendJson(res, 400, { error: "invalid_request" });
    const kind = url.searchParams.get("kind") ?? "any";
    const badge = await getService().readBadgeState({ id, login, kind, last });
    const label = contentBadgeLabel(badge.kind === "unknown" || badge.kind == null ? null : badge.kind, last);
    if (!badge.title) {
      return sendJson(res, 200, { schemaVersion: 1, label, message: "not playing", color: "lightgrey" }, CONTENT_BADGE_CACHE);
    }
    let message = badge.subtitle ? `${badge.title} — ${badge.subtitle}` : badge.title;
    if (message.length > 100) message = `${message.slice(0, 97)}...`;
    return sendJson(res, 200, { schemaVersion: 1, label, message: badge.state === "paused" ? `${message} (paused)` : message, color: "#58a6ff" }, CONTENT_BADGE_CACHE);
  } catch (error) { sendError(res, error); }
}

// One Shields endpoint badge response for an aggregate counter read: a short
// cached 200 with the compact count, or a 503 the reader can ignore.
async function badgeHandler(req, res, label, readCount) {
  if (!requireMethod(req, res, ["GET", "HEAD"])) return;
  try {
    const count = await readCount();
    sendJson(res, 200, { schemaVersion: 1, label, message: compactCount(count), color: "#58a6ff" }, { "cache-control": "public, max-age=300, s-maxage=300" });
  } catch {
    sendJson(res, 503, { schemaVersion: 1, label, message: "unavailable", color: "lightgrey" });
  }
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
