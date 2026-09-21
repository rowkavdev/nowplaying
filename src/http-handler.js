const THEMES = new Set(["midnight-blue", "paper", "compact"]);
const VISIBILITY = new Set(["artwork", "mediaType", "progress", "state", "subtitle"]);

export function parseCardQuery(searchParams) {
  for (const key of searchParams.keys()) {
    if (!["theme", "width", "show"].includes(key) || searchParams.getAll(key).length !== 1) {
      throw new TypeError("invalid card query");
    }
  }
  const options = {};
  if (searchParams.has("theme")) {
    const theme = searchParams.get("theme");
    if (!THEMES.has(theme)) throw new TypeError("invalid card query");
    options.theme = theme;
  }
  if (searchParams.has("width")) {
    const value = searchParams.get("width");
    if (!/^\d{3}$/.test(value)) throw new TypeError("invalid card query");
    const width = Number(value);
    if (width < 280 || width > 800) throw new TypeError("invalid card query");
    options.width = width;
  }
  if (searchParams.has("show")) {
    const values = searchParams.get("show").split(",").filter(Boolean);
    if (new Set(values).size !== values.length || values.some((value) => !VISIBILITY.has(value))) throw new TypeError("invalid card query");
    options.show = Object.fromEntries([...VISIBILITY].map((key) => [key, values.includes(key)]));
  }
  return Object.freeze(options);
}

export function createCardHandler({ resolveCard } = {}) {
  if (typeof resolveCard !== "function") throw new TypeError("resolveCard: expected a function");

  return async function handle(request) {
    const method = request?.method || "GET";
    const url = new URL(request?.url || "/", "http://localhost");
    if (url.pathname === "/healthz") {
      if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
      return response(200, method === "HEAD" ? "" : "ok\n", { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    }
    if (url.pathname !== "/card.svg") return response(404, "Not Found");
    if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
    let options;
    try { options = parseCardQuery(url.searchParams); }
    catch { return response(400, "Invalid card query"); }
    try {
      const svg = await resolveCard(options);
      if (typeof svg !== "string" || !svg.includes("<svg")) throw new TypeError("invalid card output");
      return response(200, method === "HEAD" ? "" : svg, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    } catch {
      return response(503, "Card unavailable");
    }
  };
}

function response(status, body, headers = {}) { return Object.freeze({ status, headers: Object.freeze(headers), body }); }
