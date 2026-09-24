import { hostname } from "node:os";
import { normalizeHostedUrl } from "./hosted-uploader.js";

// "Sign in with GitHub" for the hosted card (#140), using GitHub's device
// flow: the app shows a short code, the user approves it on github.com, and
// the app polls. No redirect server and no client secret on the PC.
// The GitHub token asks for no scopes, goes once to the hosted service's
// /api/auth/github, and is then dropped: it is never saved or logged. Only
// the hosted device key is kept, in the OS credential store.

// Public OAuth App client ID (not a secret): the "nowplaying" OAuth App,
// device flow on, no client secret. NOWPLAYING_GITHUB_CLIENT_ID overrides it
// for testing against another app.
export const GITHUB_CLIENT_ID = "Ov23liXyVPrXEWizAwIV";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const TIMEOUT_MS = 10_000;

export function createHostedGitHubSignIn({ baseUrl, credentials, clientId = process.env.NOWPLAYING_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID, fetchImpl = fetch, now = () => Date.now(), deviceName = hostname() } = {}) {
  if (typeof credentials?.load !== "function" || typeof credentials?.save !== "function") throw new TypeError("credentials are required");
  const origin = normalizeHostedUrl(baseUrl);
  let flow = null; // { deviceCode, expiresAt, intervalMs, nextPollAt }

  async function post(url, body, headers = {}) {
    const res = await fetchImpl(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...headers }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, ok: res.ok, data };
  }

  async function start() {
    if (!clientId) return { status: "not_configured" };
    let res;
    try { res = await post(DEVICE_CODE_URL, { client_id: clientId, scope: "" }); } catch { return { status: "unreachable" }; }
    const d = res.data;
    if (!res.ok || typeof d?.device_code !== "string" || typeof d?.user_code !== "string" || typeof d?.verification_uri !== "string") return { status: "github_error" };
    if (!/^https:\/\/github\.com\//.test(d.verification_uri)) return { status: "github_error" };
    const intervalMs = Math.max(5, Number(d.interval) || 5) * 1000;
    flow = { deviceCode: d.device_code, expiresAt: now() + (Number(d.expires_in) || 900) * 1000, intervalMs, nextPollAt: now() + intervalMs };
    return { status: "started", userCode: d.user_code, verificationUri: d.verification_uri, expiresIn: Math.round((flow.expiresAt - now()) / 1000), interval: intervalMs / 1000 };
  }

  async function poll() {
    if (!flow) return { status: "not_started" };
    if (now() >= flow.expiresAt) { flow = null; return { status: "expired" }; }
    if (now() < flow.nextPollAt) return { status: "pending" };
    flow.nextPollAt = now() + flow.intervalMs;
    let res;
    try { res = await post(TOKEN_URL, { client_id: clientId, device_code: flow.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }); } catch { return { status: "pending" }; }
    const d = res.data ?? {};
    if (d.error === "authorization_pending") return { status: "pending" };
    if (d.error === "slow_down") { flow.intervalMs += 5000; flow.nextPollAt = now() + flow.intervalMs; return { status: "pending" }; }
    if (d.error === "expired_token") { flow = null; return { status: "expired" }; }
    if (d.error === "access_denied") { flow = null; return { status: "denied" }; }
    if (typeof d.access_token !== "string") { flow = null; return { status: "github_error" }; }
    flow = null;
    return finish(d.access_token);
  }

  // Hands the GitHub token to the hosted service once; keeps only the device key.
  async function finish(githubToken) {
    const legacy = await credentials.load().catch(() => null);
    let res;
    try {
      res = await post(`${origin}/api/auth/github`, { githubToken, deviceName: String(deviceName || "PC").slice(0, 40), ...(legacy?.cardId && legacy?.token ? { legacyToken: legacy.token } : {}) });
    } catch { return { status: "hosted_unreachable" }; }
    const d = res.data;
    if (!res.ok || typeof d?.login !== "string" || typeof d?.deviceId !== "string" || typeof d?.token !== "string") return { status: res.status === 429 ? "rate_limited" : "hosted_error" };
    await credentials.save({ login: d.login, deviceId: d.deviceId, token: d.token });
    return { status: "signed_in", login: d.login, cardUrl: `${origin}/u/${d.login}.svg` };
  }

  return Object.freeze({ start, poll });
}
