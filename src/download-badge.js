const TAG = /^[A-Za-z0-9._-]{1,128}$/;

export function createDownloadBadgeHandler({ readReleaseDownloads } = {}) {
  if (typeof readReleaseDownloads !== "function") throw new TypeError("readReleaseDownloads: expected a function");
  return async function handle(request) {
    const method = request?.method || "GET";
    if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
    const url = new URL(request?.url || "/", "http://localhost");
    const match = /^\/badges\/downloads\/([^/]+)\.json$/.exec(url.pathname);
    if (!match || !TAG.test(match[1])) return response(404, "Not Found");
    try {
      const count = await readReleaseDownloads(match[1]);
      if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("invalid count");
      const body = JSON.stringify({ schemaVersion: 1, label: `${match[1]} downloads`, message: String(count), color: "#58a6ff" });
      return response(200, method === "HEAD" ? "" : body, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" });
    } catch {
      return response(503, JSON.stringify({ schemaVersion: 1, label: "downloads", message: "unavailable", color: "lightgrey" }), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    }
  };
}

function response(status, body, headers = {}) { return Object.freeze({ status, body, headers: Object.freeze(headers) }); }
