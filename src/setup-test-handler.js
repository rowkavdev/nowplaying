import { createProviderFromConfig } from "./app-config.js";
import { createSetupConfig } from "./setup-config.js";
import { checkProviderConnection } from "./setup-connection.js";

// Local setup API that tests the signed-in provider before setup finishes.
// It reads the saved sign-in from the credential store, asks the server what
// the signed-in user is playing once, and reports only a status word. Server
// addresses, usernames, tokens and error text never appear in the response.

const PATH = "/api/setup/test";

export function createSetupTestHandler({ store, credentialStore, fetchImpl = fetch, createProvider = createProviderFromConfig } = {}) {
  if (typeof store?.load !== "function") throw new TypeError("store.load is required");
  if (typeof credentialStore?.read !== "function") throw new TypeError("credentialStore.read is required");

  async function test() {
    const { draft } = await store.load();
    const account = draft?.account;
    if (!account || account.provider !== draft.provider) return json(409, { status: "not_signed_in" });
    let config;
    try {
      config = createSetupConfig({ provider: account.provider, serverUrl: account.serverUrl, identity: { id: account.id, displayName: account.displayName }, credentialStored: true });
    } catch {
      return json(200, { ok: false, status: "invalid_configuration" });
    }
    if (!config.serverUrl) return json(200, { ok: false, status: "missing_server" });
    let secret;
    try {
      secret = await credentialStore.read({ provider: account.provider, identityId: account.id });
    } catch {
      return json(200, { ok: false, status: "credential_unavailable" });
    }
    if (typeof secret !== "string" || !secret) return json(200, { ok: false, status: "credential_unavailable" });
    const result = await checkProviderConnection({ createProvider: (value) => createProvider(value, secret, { fetchImpl }), config });
    return json(200, { ok: result.ok, status: result.status, activity: result.activity });
  }

  return async function handle(request = {}) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname !== PATH) return null;
    if ((request.method || "GET") !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
    if (url.search) return json(400, { error: "invalid_request" });
    try {
      return await test();
    } catch {
      return json(500, { error: "test_failed" });
    }
  };
}

function json(status, value, extra = {}) {
  return Object.freeze({
    status,
    headers: Object.freeze({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }),
    body: `${JSON.stringify(value)}\n`,
  });
}
