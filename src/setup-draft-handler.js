import { SetupStepError, advanceSetupDraft, createSetupDraft, previousSetupDraft } from "./setup.js";

const PATH = "/api/setup/draft";
const ACTIONS = new Set(["save", "next", "back"]);
const CHANGE_KEYS = new Set(["provider", "discordEnabled", "discordIdleBehavior", "startWithWindows"]);

// onFinish runs when the review step is confirmed, before the draft moves to
// "complete"; if it throws, the wizard stays on review so the user can retry.
export function createSetupDraftHandler({ store, signIn = true, onFinish = async () => {} } = {}) {
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
      return json(200, { draft: (await store.load()).draft, resumed: false, discarded: false });
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
      next = input.action === "next" ? advanceSetupDraft(merged, {}, { signIn }) : input.action === "back" ? previousSetupDraft(merged, { signIn }) : merged;
    } catch (error) {
      if (error instanceof SetupStepError) return json(409, { error: error.code });
      return json(400, { error: "invalid_changes" });
    }
    if (input.action === "next" && next.step === "complete" && next.step !== (await store.load()).draft.step) {
      try { await onFinish(next); }
      catch { return json(500, { error: "finish_failed" }); }
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
