import { randomBytes } from "node:crypto";
import { signInToSpotify } from "./spotify-signin.js";

// Local setup API for the optional Spotify sign-in (#135). Spotify only feeds
// the card and hosted card, never Discord. The page (or native window) sends
// the user's own Client ID and gets back Spotify's consent link to open plus
// an opaque flow id to poll. The refresh token goes straight to the
// credential store; responses and the draft carry the identity only.

const PATH = "/api/setup/spotify";
const AUTH_ORIGIN = "https://accounts.spotify.com/";
const CLIENT_ID = /^[0-9a-f]{32}$/i;
const ERRORS = Object.freeze({ denied: "denied", timeout: "expired", bad_client_id: "bad_client_id" });

export function createSetupSpotifyHandler({
  credentialStore, onSignedIn = async () => {}, signIn = signInToSpotify,
  now = Date.now, flowTtlMs = 10 * 60_000, maxFlows = 2, newFlowId = () => randomBytes(18).toString("base64url"),
} = {}) {
  if (typeof credentialStore?.save !== "function") throw new TypeError("credentialStore.save is required");
  if (typeof signIn !== "function") throw new TypeError("signIn must be a function");
  const flows = new Map();

  function prune() {
    const time = now();
    for (const [id, flow] of flows) if (flow.expiresAt <= time) flows.delete(id);
  }

  async function complete(flow, tokens) {
    const identity = tokens?.identity;
    if (typeof tokens?.refreshToken !== "string" || !tokens.refreshToken || typeof identity?.id !== "string" || !identity.id) {
      flow.result = { status: "failed", error: "spotify_failed" };
      return;
    }
    const safeIdentity = { id: identity.id, displayName: typeof identity.displayName === "string" && identity.displayName ? identity.displayName : identity.id };
    try {
      await credentialStore.save({ provider: "spotify", identityId: safeIdentity.id }, tokens.refreshToken);
    } catch {
      flow.result = { status: "failed", error: "credential_store_failed" };
      return;
    }
    try {
      await onSignedIn({ clientId: flow.clientId, identity: safeIdentity });
    } catch {
      flow.result = { status: "failed", error: "draft_update_failed" };
      return;
    }
    flow.result = { status: "signed_in", identity: safeIdentity };
  }

  async function start(input) {
    if (!onlyKeys(input, ["action", "clientId"]) || typeof input.clientId !== "string") return json(400, { error: "invalid_request" });
    const clientId = input.clientId.trim();
    if (!CLIENT_ID.test(clientId)) return json(400, { error: "bad_client_id" });
    prune();
    if (flows.size >= maxFlows) return json(429, { error: "too_many_signins" });
    const flow = { clientId, expiresAt: now() + flowTtlMs, result: { status: "pending" } };
    let giveUrl;
    const authUrl = new Promise((resolve) => { giveUrl = resolve; });
    let running;
    try {
      running = signIn({ clientId, openUrl: async (url) => { giveUrl(url); } });
    } catch {
      return json(502, { error: "spotify_failed" });
    }
    running.then((tokens) => complete(flow, tokens), (error) => {
      flow.result = { status: "failed", error: ERRORS[error?.code] ?? "spotify_failed" };
      giveUrl(null);
    });
    const url = await authUrl;
    if (typeof url !== "string" || !url.startsWith(AUTH_ORIGIN)) return json(502, { error: flow.result.error ?? "spotify_failed" });
    const flowId = newFlowId();
    flows.set(flowId, flow);
    return json(200, { status: "pending", flowId, authUrl: url });
  }

  function poll(input) {
    if (!onlyKeys(input, ["action", "flowId"]) || typeof input.flowId !== "string") return json(400, { error: "invalid_request" });
    const flow = flows.get(input.flowId);
    if (!flow || flow.expiresAt <= now()) { flows.delete(input.flowId); return json(410, { error: "expired" }); }
    if (flow.result.status === "pending") return json(200, { status: "pending" });
    flows.delete(input.flowId);
    if (flow.result.status === "signed_in") return json(200, { status: "signed_in", provider: "spotify", identity: flow.result.identity });
    return json(400, { error: flow.result.error });
  }

  return async function handle(request = {}) {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== PATH) return null;
    if (url.search) return json(400, { error: "invalid_request" });
    if ((request.method || "GET") !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
    let input;
    try { input = JSON.parse(typeof request.body === "string" ? request.body : ""); } catch { return json(400, { error: "invalid_json" }); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json(400, { error: "invalid_request" });
    if (input.action === "start") return start(input);
    if (input.action === "poll") return poll(input);
    return json(400, { error: "invalid_request" });
  };
}

function onlyKeys(input, keys) { return Object.keys(input).every((key) => keys.includes(key)); }

function json(status, value, extra = {}) {
  return Object.freeze({
    status,
    headers: Object.freeze({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }),
    body: `${JSON.stringify(value)}\n`,
  });
}
