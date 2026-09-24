import { hostedUploadPreview, checkHostedEndpoint } from "./hosted-preview.js";
import { DEFAULT_HOSTED_URL, normalizeHostedUrl } from "./hosted-uploader.js";
import { createHostedGitHubSignIn } from "./hosted-signin.js";

// API for the setup wizard's "Card hosting" step (#140, #141):
//   GET  /api/setup/hosted/preview   exactly which fields would leave the PC
//   POST /api/setup/hosted/check     { url } - is this a nowplaying card service? (self-hosted)
//   POST /api/setup/hosted/signin    { action: "start", url? } | { action: "poll" }
//        GitHub device flow: start returns { status, userCode, verificationUri };
//        poll returns pending | signed_in (with login, cardUrl) | expired | denied.
//        The device key goes to the OS credential store, never the draft.
// Choosing hosting on the draft (hostedEnabled/hostedUrl) goes through
// /api/setup/draft as usual.
const BASE = "/api/setup/hosted/";
const MAX_BODY = 2048;

export function createSetupHostedHandler({ settings = async () => ({}), fetchImpl = fetch, checkEndpoint = checkHostedEndpoint, credentials = null, createSignIn = createHostedGitHubSignIn } = {}) {
  let signIn = null;
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

    if (action !== "check" && action !== "signin") return json(404, { error: "not_found" });
    if (method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
    const input = parseBody(request.body);
    if (action === "signin") {
      if (!input || Object.keys(input).some((k) => k !== "action" && k !== "url")) return json(400, { error: "invalid_request" });
      if (!credentials) return json(409, { status: "no_credential_store" });
      if (input.action === "start") {
        let baseUrl;
        try { baseUrl = normalizeHostedUrl(input.url ?? DEFAULT_HOSTED_URL); } catch { return json(400, { status: "invalid_url" }); }
        signIn = createSignIn({ baseUrl, credentials, ...(fetchImpl ? { fetchImpl } : {}) });
        return json(200, await signIn.start());
      }
      if (input.action === "poll") {
        if (!signIn) return json(200, { status: "not_started" });
        const result = await signIn.poll();
        if (result.status !== "pending") signIn = null;
        return json(200, result);
      }
      return json(400, { error: "invalid_request" });
    }
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
