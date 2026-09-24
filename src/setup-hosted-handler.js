import { hostedUploadPreview, checkHostedEndpoint } from "./hosted-preview.js";
import { DEFAULT_HOSTED_URL } from "./hosted-uploader.js";

// API for the setup wizard's "Card hosting" step (#140, #141):
//   GET  /api/setup/hosted/preview   exactly which fields would leave the PC
//   POST /api/setup/hosted/check     { url } - is this a nowplaying card service? (self-hosted)
// Choosing hosting on the draft (hostedEnabled/hostedUrl) goes through
// /api/setup/draft as usual. Signing this PC in to the hosted service is a
// separate step, coming with GitHub sign-in (#140).
const BASE = "/api/setup/hosted/";
const MAX_BODY = 2048;

export function createSetupHostedHandler({ settings = async () => ({}), fetchImpl = fetch, checkEndpoint = checkHostedEndpoint } = {}) {
  return async function handle(request = {}) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (!url.pathname.startsWith(BASE)) return null;
    const action = url.pathname.slice(BASE.length);
    const method = request.method || "GET";
    if (url.search) return json(400, { error: "invalid_request" });

    if (action === "preview") {
      if (method !== "GET") return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
      try { return json(200, { ...hostedUploadPreview(await settings()), defaultUrl: DEFAULT_HOSTED_URL }); }
      catch { return json(500, { error: "preview_failed" }); }
    }

    if (action !== "check") return json(404, { error: "not_found" });
    if (method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
    const input = parseBody(request.body);
    if (!input || Object.keys(input).some((k) => k !== "url") || (input.url !== undefined && typeof input.url !== "string")) return json(400, { error: "invalid_request" });

    if (!input.url) return json(400, { error: "invalid_request" });
    return json(200, await checkEndpoint(input.url, { fetchImpl }));
  };
}

function parseBody(body) {
  if (body === undefined || body === null || body === "") return {};
  const text = typeof body === "string" ? body : Buffer.isBuffer(body) ? body.toString("utf8") : null;
  if (text === null || text.length > MAX_BODY) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function json(status, value, extra = {}) {
  return Object.freeze({ status, headers: Object.freeze({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }), body: `${JSON.stringify(value)}\n` });
}
