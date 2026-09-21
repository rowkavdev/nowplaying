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
    try {
      const svg = await resolveCard();
      if (typeof svg !== "string" || !svg.includes("<svg")) throw new TypeError("invalid card output");
      return response(200, method === "HEAD" ? "" : svg, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    } catch {
      return response(503, "Card unavailable");
    }
  };
}

function response(status, body, headers = {}) { return Object.freeze({ status, headers: Object.freeze(headers), body }); }
