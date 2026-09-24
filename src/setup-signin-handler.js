import { randomBytes } from "node:crypto";
import {
  SignInError, normalizeServerUrl, pollJellyfinQuickConnect, pollPlexPin, signInEmby, signInNavidrome, startJellyfinQuickConnect, startPlexPin,
} from "./provider-signin.js";
import { NETWORK_FAILURES } from "./setup-network-failure.js";

// Local setup API for provider sign-in. The page (or the native window) only
// ever sees what the user must act on: a Plex sign-in link or a Jellyfin Quick
// Connect code, plus an opaque flow id. PIN ids, Quick Connect secrets, tokens
// and passwords stay in this process, and a successful sign-in writes the
// secret straight to the credential store. Responses carry the identity only.

const PATH = "/api/setup/signin";
const FLOW_PROVIDERS = new Set(["plex", "jellyfin"]);
const PASSWORD_PROVIDERS = new Set(["emby", "navidrome"]);
const MAX_FIELD = 2048;

export const DEFAULT_SIGNIN = Object.freeze({
  startPlexPin, pollPlexPin, startJellyfinQuickConnect, pollJellyfinQuickConnect, signInEmby, signInNavidrome,
});

export function createSetupSignInHandler({
  credentialStore, deviceId, version = "0", signIn = DEFAULT_SIGNIN, now = Date.now, onSignedIn = async () => {},
  flowTtlMs = 10 * 60_000, maxFlows = 4, newFlowId = () => randomBytes(18).toString("base64url"),
} = {}) {
  if (typeof credentialStore?.save !== "function") throw new TypeError("credentialStore.save is required");
  if (typeof deviceId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(deviceId)) throw new TypeError("deviceId is invalid");
  const flows = new Map();

  function prune() {
    const time = now();
    for (const [id, flow] of flows) if (flow.expiresAt <= time) flows.delete(id);
  }

  async function finish(result, serverUrl) {
    try {
      await credentialStore.save({ provider: result.provider, identityId: result.identity.id }, result.secret);
    } catch {
      return json(500, { error: "credential_store_failed" });
    }
    const identity = { id: result.identity.id, displayName: result.identity.displayName };
    try {
      await onSignedIn({ provider: result.provider, identity, ...(serverUrl ? { serverUrl } : {}) });
    } catch {
      return json(500, { error: "draft_update_failed" });
    }
    return json(200, { status: "signed_in", provider: result.provider, identity: { id: result.identity.id, displayName: result.identity.displayName } });
  }

  async function start(input) {
    if (!onlyKeys(input, ["action", "provider", "baseUrl"]) || !FLOW_PROVIDERS.has(input.provider)) return json(400, { error: "invalid_request" });
    prune();
    if (flows.size >= maxFlows) return json(429, { error: "too_many_signins" });
    const flowId = newFlowId();
    if (input.provider === "plex") {
      // Plex signs in through plex.tv; baseUrl is only the local server the
      // app will read from afterwards, remembered with the account.
      const serverUrl = input.baseUrl === undefined ? undefined : normalizeServerUrl(input.baseUrl);
      const pin = await signIn.startPlexPin({ clientId: deviceId });
      flows.set(flowId, { provider: "plex", pinId: pin.pinId, serverUrl, expiresAt: now() + flowTtlMs });
      return json(200, { status: "pending", flowId, provider: "plex", authUrl: pin.authUrl });
    }
    if (!text(input.baseUrl)) return json(400, { error: "invalid_request" });
    const qc = await signIn.startJellyfinQuickConnect({ baseUrl: input.baseUrl, deviceId, version });
    flows.set(flowId, { provider: "jellyfin", baseUrl: input.baseUrl, serverUrl: normalizeServerUrl(input.baseUrl), secret: qc.secret, expiresAt: now() + flowTtlMs });
    return json(200, { status: "pending", flowId, provider: "jellyfin", code: qc.code });
  }

  async function poll(input) {
    if (!onlyKeys(input, ["action", "flowId"]) || !text(input.flowId)) return json(400, { error: "invalid_request" });
    prune();
    const flow = flows.get(input.flowId);
    if (!flow) return json(410, { error: "expired" });
    let result;
    try {
      result = flow.provider === "plex"
        ? await signIn.pollPlexPin({ clientId: deviceId, pinId: flow.pinId })
        : await signIn.pollJellyfinQuickConnect({ baseUrl: flow.baseUrl, secret: flow.secret, deviceId, version });
    } catch (error) {
      flows.delete(input.flowId);
      throw error;
    }
    if (result.status !== "signed_in") return json(200, { status: "pending" });
    flows.delete(input.flowId);
    return finish(result, flow.serverUrl);
  }

  async function password(input) {
    if (!onlyKeys(input, ["action", "provider", "baseUrl", "username", "password"]) || !PASSWORD_PROVIDERS.has(input.provider)) return json(400, { error: "invalid_request" });
    if (!text(input.baseUrl) || !text(input.username) || typeof input.password !== "string" || input.password.length > MAX_FIELD) return json(400, { error: "invalid_request" });
    const result = input.provider === "emby"
      ? await signIn.signInEmby({ baseUrl: input.baseUrl, username: input.username, password: input.password, deviceId, version })
      : await signIn.signInNavidrome({ baseUrl: input.baseUrl, username: input.username, password: input.password });
    return finish(result, normalizeServerUrl(input.baseUrl));
  }

  async function cancel(input) {
    if (!onlyKeys(input, ["action", "flowId"]) || !text(input.flowId)) return json(400, { error: "invalid_request" });
    flows.delete(input.flowId);
    return json(200, { status: "cancelled" });
  }

  const actions = { start, poll, password, cancel };

  return async function handle(request = {}) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname !== PATH) return null;
    if ((request.method || "GET") !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
    if (url.search) return json(400, { error: "invalid_request" });
    let input;
    try { input = JSON.parse(typeof request.body === "string" ? request.body : ""); }
    catch { return json(400, { error: "invalid_json" }); }
    if (!input || typeof input !== "object" || Array.isArray(input) || !Object.hasOwn(actions, input.action)) return json(400, { error: "invalid_request" });
    try {
      return await actions[input.action](input);
    } catch (error) {
      if (error instanceof SignInError) return json(NETWORK_FAILURES.includes(error.status) ? 502 : 400, { error: error.status });
      return json(500, { error: "signin_failed" });
    }
  };
}

function onlyKeys(input, allowed) {
  return Object.keys(input).every((key) => allowed.includes(key));
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_FIELD;
}

function json(status, value, extra = {}) {
  return Object.freeze({
    status,
    headers: Object.freeze({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }),
    body: `${JSON.stringify(value)}\n`,
  });
}
