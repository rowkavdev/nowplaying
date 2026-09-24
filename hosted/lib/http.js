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
  const layout = parseLayoutOptions(searchParams);
  return { theme, width, show, ...(Object.keys(layout).length ? { layout } : {}) };
}

// Card layout from the URL only (#94). Nothing here comes from the PC's
// ingest payload. Numeric ranges match settings.js card.layout; the choices
// match what the renderer accepts. Artwork options are left out because the
// hosted card never draws artwork.
const LAYOUT_NUMBERS = Object.freeze({ padding: [12, 48], radius: [0, 24], titleSize: [14, 30], subtitleSize: [10, 20], progressHeight: [2, 12] });
const LAYOUT_CHOICES = Object.freeze({ textAlign: ["start", "middle", "end"], progressPosition: ["bottom", "text"], progressWidth: ["content", "full"], direction: ["ltr", "rtl", "auto"] });
const CARD_FIELDS = Object.freeze(["state", "title", "subtitle"]);
function parseLayoutOptions(searchParams) {
  const layout = {};
  for (const [key, [min, max]] of Object.entries(LAYOUT_NUMBERS)) {
    const raw = single(searchParams, key);
    if (raw === null) continue;
    const value = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < min || value > max) throw new ServiceError(400, "invalid_layout");
    layout[key] = value;
  }
  for (const [key, allowed] of Object.entries(LAYOUT_CHOICES)) {
    const raw = single(searchParams, key);
    if (raw === null) continue;
    if (!allowed.includes(raw)) throw new ServiceError(400, "invalid_layout");
    layout[key] = raw;
  }
  const order = single(searchParams, "fieldOrder");
  if (order !== null) {
    const fields = order.split(",");
    if (fields.length !== 3 || new Set(fields).size !== 3 || !fields.every((field) => CARD_FIELDS.includes(field))) throw new ServiceError(400, "invalid_layout");
    layout.fieldOrder = fields;
  }
  return layout;
}

function single(searchParams, key) {
  const values = searchParams.getAll(key);
  if (values.length > 1) throw new ServiceError(400, "invalid_layout");
  return values.length ? values[0] : null;
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
