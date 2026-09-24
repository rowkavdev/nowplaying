import { createHash, randomBytes } from "node:crypto";

// Spotify sign-in for #135: Authorization Code with PKCE, so the desktop app
// never holds a client secret. Each user registers their own Spotify app and
// gives us its Client ID (Rowan's call: bring your own).
//
// Spotify only accepts loopback redirects as an IP literal
// (http://127.0.0.1:<port>/...), never "localhost".
// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_SCOPES = Object.freeze(["user-read-currently-playing"]);

export class SpotifyAuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SpotifyAuthError";
    this.code = code;
    // Lets the status page show "sign in again" rather than a generic error.
    if (code === "reauth_needed") this.status = 401;
  }
}

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function checkClientId(clientId) {
  if (typeof clientId !== "string" || !/^[0-9a-f]{32}$/i.test(clientId.trim())) {
    throw new SpotifyAuthError("Spotify Client ID should be the 32-character ID from your Spotify app", "bad_client_id");
  }
  return clientId.trim();
}

export function checkRedirectUri(value) {
  let url;
  try { url = new URL(value); } catch { throw new SpotifyAuthError("Spotify redirect address is invalid", "bad_redirect"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new SpotifyAuthError("Spotify redirect must be http://127.0.0.1 (Spotify refuses localhost)", "bad_redirect");
  }
  return url.toString();
}

export function createPkcePair(random = randomBytes) {
  const verifier = base64url(random(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return Object.freeze({ verifier, challenge });
}

export function buildAuthorizeUrl({ clientId, redirectUri, state, challenge }) {
  if (typeof state !== "string" || state.length < 16) throw new TypeError("state must be at least 16 characters");
  if (typeof challenge !== "string" || !challenge) throw new TypeError("challenge is required");
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: checkClientId(clientId),
    response_type: "code",
    redirect_uri: checkRedirectUri(redirectUri),
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES.join(" "),
    state,
  }).toString();
  return url.toString();
}

// Reads the redirect Spotify sends back. Returns the code, or throws if the
// user said no or the state doesn't match (a request we didn't start).
export function readCallback(callbackUrl, expectedState) {
  const params = new URL(callbackUrl, "http://127.0.0.1").searchParams;
  if (!expectedState || params.get("state") !== expectedState) throw new SpotifyAuthError("Spotify sign-in did not match this request", "state_mismatch");
  if (params.get("error")) throw new SpotifyAuthError(params.get("error") === "access_denied" ? "Spotify access was not allowed" : "Spotify sign-in failed", "denied");
  const code = params.get("code");
  if (!code) throw new SpotifyAuthError("Spotify sign-in returned no code", "no_code");
  return code;
}

async function tokenRequest(fields, fetchImpl) {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* keep empty */ }
  if (!response.ok) {
    // invalid_grant: the refresh token was revoked or expired, so the user must sign in again.
    const code = payload?.error === "invalid_grant" ? "reauth_needed" : "token_failed";
    throw new SpotifyAuthError(code === "reauth_needed" ? "Spotify sign-in has expired, sign in again" : `Spotify token request failed: ${response.status}`, code);
  }
  if (typeof payload.access_token !== "string" || !payload.access_token) throw new SpotifyAuthError("Spotify returned no access token", "token_failed");
  const expiresIn = Number.isFinite(payload.expires_in) && payload.expires_in > 0 ? payload.expires_in : 3600;
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" && payload.refresh_token ? payload.refresh_token : null,
    expiresInMs: expiresIn * 1000,
  };
}

export async function exchangeCode({ clientId, code, redirectUri, verifier, fetchImpl = fetch }) {
  if (typeof code !== "string" || !code) throw new TypeError("code is required");
  if (typeof verifier !== "string" || !verifier) throw new TypeError("verifier is required");
  return tokenRequest({
    grant_type: "authorization_code", code, redirect_uri: checkRedirectUri(redirectUri),
    client_id: checkClientId(clientId), code_verifier: verifier,
  }, fetchImpl);
}

export async function refreshAccessToken({ clientId, refreshToken, fetchImpl = fetch }) {
  if (typeof refreshToken !== "string" || !refreshToken) throw new SpotifyAuthError("Not signed in to Spotify", "reauth_needed");
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: checkClientId(clientId) }, fetchImpl);
}

// getAccessToken() for the Spotify provider. Keeps the access token in memory
// only, refreshes a minute before it expires, and saves a rotated refresh
// token straight away (Spotify may issue a new one on each refresh).
export function createSpotifyTokenSource({ clientId, readRefreshToken, saveRefreshToken, fetchImpl = fetch, now = Date.now }) {
  checkClientId(clientId);
  if (typeof readRefreshToken !== "function" || typeof saveRefreshToken !== "function") {
    throw new TypeError("readRefreshToken and saveRefreshToken are required");
  }
  let cached = null;
  let pending = null;
  async function refresh() {
    const result = await refreshAccessToken({ clientId, refreshToken: await readRefreshToken(), fetchImpl });
    if (result.refreshToken) await saveRefreshToken(result.refreshToken);
    cached = { token: result.accessToken, expiresAt: now() + result.expiresInMs - 60_000 };
    return cached.token;
  }
  return Object.freeze({
    async getAccessToken() {
      if (cached && now() < cached.expiresAt) return cached.token;
      pending ??= refresh().finally(() => { pending = null; });
      return pending;
    },
    forget() { cached = null; },
  });
}
