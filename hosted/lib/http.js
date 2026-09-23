import { createHash } from "node:crypto";
import { renderCard, cardThemes } from "../../src/card.js";
import { MAX_INGEST_BYTES, ServiceError } from "./service.js";

const SHOW_FIELDS = new Set(["artwork", "mediaType", "progress", "state", "subtitle"]);

export function sendJson(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
}

export function sendError(res, error) {
  if (error instanceof ServiceError) return sendJson(res, error.status, { error: error.code });
  // Never echo internal errors: they may carry request data.
  return sendJson(res, 500, { error: "internal_error" });
}

export async function readJsonBody(req, limit = MAX_INGEST_BYTES) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new ServiceError(413, "payload_too_large");
  const type = String(req.headers["content-type"] ?? "");
  if (!type.toLowerCase().startsWith("application/json")) throw new ServiceError(415, "unsupported_media_type");
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new ServiceError(413, "payload_too_large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ServiceError(400, "invalid_json"); }
}

export function bearerToken(req) {
  const header = String(req.headers.authorization ?? "");
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
  return match ? match[1] : null;
}

export function requireMethod(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader("allow", methods.join(", "));
  sendJson(res, 405, { error: "method_not_allowed" });
  return false;
}

export function parseCardOptions(searchParams) {
  const theme = searchParams.get("theme") ?? "midnight-blue";
  if (!Object.hasOwn(cardThemes, theme)) throw new ServiceError(400, "invalid_theme");
  const widthRaw = searchParams.get("width");
  const width = widthRaw === null ? 440 : Number(widthRaw);
  if (!Number.isInteger(width) || width < 280 || width > 800) throw new ServiceError(400, "invalid_width");
  const showRaw = searchParams.get("show");
  let show = {};
  if (showRaw !== null) {
    const picked = showRaw.split(",").filter(Boolean);
    for (const field of picked) if (!SHOW_FIELDS.has(field)) throw new ServiceError(400, "invalid_show");
    show = Object.fromEntries([...SHOW_FIELDS].map((field) => [field, picked.includes(field)]));
  }
  return { theme, width, show };
}

export function sendCard(req, res, presence, options) {
  const svg = renderCard(presence, { ...options, show: { ...options.show, artwork: false } });
  const etag = `"${createHash("sha256").update(svg).digest("base64url").slice(0, 27)}"`;
  res.setHeader("content-type", "image/svg+xml; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=30, s-maxage=30");
  res.setHeader("etag", etag);
  res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  if (req.headers["if-none-match"] === etag) { res.statusCode = 304; return res.end(); }
  res.statusCode = 200;
  res.end(req.method === "HEAD" ? undefined : svg);
}
