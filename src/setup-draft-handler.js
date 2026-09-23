import { advanceSetupDraft, createSetupDraft, previousSetupDraft } from "./setup.js";

const PATH = "/api/setup/draft";
const ACTIONS = new Set(["save", "next", "back"]);
const CHANGE_KEYS = new Set(["provider", "discordEnabled", "discordIdleBehavior"]);

export function createSetupDraftHandler({ store } = {}) {
  if (!store || typeof store.load !== "function" || typeof store.save !== "function" || typeof store.clear !== "function") {
    throw new TypeError("setup draft handler.store is invalid");
  }

  return async function handle(request = {}) {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== PATH) return null;
    if (url.search) return json(400, { error: "invalid_request" });
    const method = request.method || "GET";

    if (method === "GET") {
      const { draft, resumed, discarded } = await store.load();
      return json(200, { draft, resumed, discarded });
    }
    if (method === "DELETE") {
      await store.clear();
      return json(200, { draft: createSetupDraft(), resumed: false, discarded: false });
    }
    if (method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "GET, POST, DELETE" });

    let input;
    try { input = JSON.parse(typeof request.body === "string" ? request.body : ""); }
    catch { return json(400, { error: "invalid_json" }); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json(400, { error: "invalid_request" });
    const keys = Object.keys(input);
    if (keys.some((key) => key !== "action" && key !== "changes") || !ACTIONS.has(input.action)) return json(400, { error: "invalid_request" });
    const changes = input.changes ?? {};
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).some((key) => !CHANGE_KEYS.has(key))) {
      return json(400, { error: "invalid_changes" });
    }

    let next;
    try {
      const { draft } = await store.load();
      const merged = createSetupDraft({ ...draft, ...changes });
      next = input.action === "next" ? advanceSetupDraft(merged) : input.action === "back" ? previousSetupDraft(merged) : merged;
    } catch {
      return json(400, { error: "invalid_changes" });
    }
    const saved = await store.save(next);
    return json(200, { draft: saved });
  };
}

function json(status, value, extra = {}) {
  return Object.freeze({
    status,
    headers: Object.freeze({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }),
    body: `${JSON.stringify(value)}\n`,
  });
}
