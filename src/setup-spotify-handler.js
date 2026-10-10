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
  elapsedNow = () => performance.now(), flowTtlMs = 10 * 60_000, maxFlows = 2, newFlowId = () => randomBytes(18).toString("base64url"),
} = {}) {
  if (typeof credentialStore?.save !== "function") throw new TypeError("credentialStore.save is required");
  if (typeof signIn !== "function") throw new TypeError("signIn must be a function");
  const flows = new Map();
  const completing = new Set();
  let generation = 0;
  // Consent links arrive after the loopback listener starts. Reserve capacity
  // before that await so parallel requests cannot all claim the same slot.
  let starting = 0;
  // Newest start per Client ID wins (#703): each start supersedes older
  // pending flows for the same account, so a stale completion can never
  // overwrite a newer sign-in's credential or config.
  const latestByClientId = new Map();
  const superseded = (flow) => latestByClientId.get(flow.clientId) !== flow.overlap;
  // Write sections for the same account run one at a time (#703): a stale
  // flow's save/restore cleanup must land strictly before or after a newer
  // flow's writes, never interleaved with them.
  const writeChains = new Map();

  function prune() {
    const time = elapsedNow();
    for (const [id, flow] of flows) if (!flow.committing && (flow.expiresAt <= time || superseded(flow))) flows.delete(id);
  }

  async function complete(flow, tokens) {
    const active = () => flow.generation === generation && !superseded(flow);
    // A late OAuth completion must not revive a flow already reported expired.
    if (!active() || flow.expiresAt <= elapsedNow()) return;
    const identity = tokens?.identity;
    if (typeof tokens?.refreshToken !== "string" || !tokens.refreshToken || typeof identity?.id !== "string" || !identity.id) {
      flow.result = { status: "failed", error: "spotify_failed" };
      return;
    }
    const safeIdentity = { id: identity.id, displayName: typeof identity.displayName === "string" && identity.displayName ? identity.displayName : identity.id };
    // The draft/config write can fail after a token was saved. Keep the old
    // token so a failed repeat sign-in never replaces a working credential.
    if (typeof credentialStore.read !== "function" || typeof credentialStore.remove !== "function") {
      flow.result = { status: "failed", error: "credential_store_failed" };
      return;
    }
    const prior = writeChains.get(safeIdentity.id) ?? Promise.resolve();
    const turn = prior.then(() => writeCredential(flow, tokens.refreshToken, safeIdentity, active));
    writeChains.set(safeIdentity.id, turn.then(() => {}, () => {}));
    await turn;
  }

  async function writeCredential(flow, refreshToken, safeIdentity, active) {
    // The chain wait can itself outlast the flow or see it superseded.
    if (!active() || flow.expiresAt <= elapsedNow()) return;
    const ref = { provider: "spotify", identityId: safeIdentity.id };
    let previous;
    try { previous = await credentialStore.read(ref); }
    catch { flow.result = { status: "failed", error: "credential_store_failed" }; return; }
    // Reading a keychain may itself outlast the flow. Check again before writes.
    if (!active() || flow.expiresAt <= elapsedNow()) return;
    async function restore() {
      if (previous === null || previous === undefined) await credentialStore.remove(ref);
      else await credentialStore.save(ref, previous);
    }
    try { await credentialStore.save(ref, refreshToken); }
    catch {
      // An adapter might persist the value before reporting failure.
      try { await restore(); } catch { /* Cannot promise recovery. */ }
      flow.result = { status: "failed", error: "credential_store_failed" };
      return;
    }
    // The credential save can also cross expiry. Undo it before the draft write.
    if (!active() || flow.expiresAt <= elapsedNow()) {
      try { await restore(); }
      catch { flow.result = { status: "failed", error: "credential_store_failed" }; }
      return;
    }
    // Committed boundary: once the draft write starts, this flow finishes and
    // reports its result even if a newer start supersedes it meanwhile; the
    // newer flow's own write section then overwrites the credential. Keep the
    // flow pollable until the write settles rather than reporting 410.
    flow.committing = true;
    try { await onSignedIn({ clientId: flow.clientId, identity: safeIdentity }); }
    catch {
      try { await restore(); }
      catch { flow.result = { status: "failed", error: "credential_store_failed" }; return; }
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
    if (flows.size + starting >= maxFlows) return json(429, { error: "too_many_signins" });
    starting++;
    try { return await startFlow(clientId); }
    finally { starting--; }
  }

  async function startFlow(clientId) {
    const overlap = (latestByClientId.get(clientId) ?? 0) + 1;
    latestByClientId.set(clientId, overlap);
    const flow = { clientId, overlap, generation, expiresAt: elapsedNow() + flowTtlMs, result: { status: "pending" } };
    let giveUrl;
    const authUrl = new Promise((resolve) => { giveUrl = resolve; });
    let running;
    try {
      running = signIn({ clientId, openUrl: async (url) => { giveUrl(url); } });
    } catch {
      return json(502, { error: "spotify_failed" });
    }
    running.then((tokens) => {
      const work = complete(flow, tokens);
      completing.add(work);
      void work.then(() => completing.delete(work), () => {
        completing.delete(work);
        flow.result = { status: "failed", error: "spotify_failed" };
      });
    }, (error) => {
      flow.result = { status: "failed", error: ERRORS[error?.code] ?? "spotify_failed" };
      giveUrl(null);
    });
    const url = await authUrl;
    if (flow.generation !== generation || superseded(flow)) return json(410, { error: "expired" });
    if (typeof url !== "string" || !url.startsWith(AUTH_ORIGIN)) return json(502, { error: flow.result.error ?? "spotify_failed" });
    const flowId = newFlowId();
    flows.set(flowId, flow);
    return json(200, { status: "pending", flowId, authUrl: url });
  }

  function poll(input) {
    if (!onlyKeys(input, ["action", "flowId"]) || typeof input.flowId !== "string") return json(400, { error: "invalid_request" });
    const flow = flows.get(input.flowId);
    if (!flow || (!flow.committing && (flow.expiresAt <= elapsedNow() || superseded(flow)))) { flows.delete(input.flowId); return json(410, { error: "expired" }); }
    if (flow.result.status === "pending") return json(200, { status: "pending" });
    flows.delete(input.flowId);
    if (flow.result.status === "signed_in") return json(200, { status: "signed_in", provider: "spotify", identity: flow.result.identity });
    return json(400, { error: flow.result.error });
  }

  async function cancelPending() {
    // Invalidate starts that have not returned yet, then let any credential or
    // draft write already in flight settle before disconnect removes them.
    generation++;
    flows.clear();
    await Promise.allSettled([...completing]);
  }

  async function handle(request = {}) {
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
  }
  handle.cancelPending = cancelPending;
  return handle;
}

function onlyKeys(input, keys) { return Object.keys(input).every((key) => keys.includes(key)); }

function json(status, value, extra = {}) {
  return Object.freeze({
    status,
    headers: Object.freeze({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }),
    body: `${JSON.stringify(value)}\n`,
  });
}
