import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SPOTIFY_SCOPES, buildAuthorizeUrl, checkRedirectUri, createPkcePair, createSpotifyTokenSource,
  exchangeCode, readCallback, refreshAccessToken,
} from "../src/spotify-auth.js";

const clientId = "0123456789abcdef0123456789abcdef";
const redirectUri = "http://127.0.0.1:43110/spotify/callback";

function tokenFetch(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(init.body) });
    const [status, body] = replies.shift();
    return { ok: status < 300, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

test("PKCE pair uses S256 and a long verifier (#135)", () => {
  const { verifier, challenge } = createPkcePair();
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  const expected = createHash("sha256").update(verifier).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(challenge, expected);
});

test("authorize URL asks only for the minimum scope and has no secret", () => {
  const url = new URL(buildAuthorizeUrl({ clientId, redirectUri, state: "s".repeat(16), challenge: "abc" }));
  assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
  assert.equal(url.searchParams.get("scope"), "user-read-currently-playing");
  assert.deepEqual([...SPOTIFY_SCOPES], ["user-read-currently-playing"]);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(url.searchParams.has("client_secret"), false);
  assert.throws(() => buildAuthorizeUrl({ clientId: "nope", redirectUri, state: "s".repeat(16), challenge: "abc" }), /Client ID/);
  assert.throws(() => buildAuthorizeUrl({ clientId, redirectUri, state: "short", challenge: "abc" }), /state/);
});

test("redirect must be a loopback IP, never localhost", () => {
  assert.equal(checkRedirectUri("http://[::1]:5000/cb"), "http://[::1]:5000/cb");
  for (const bad of ["http://localhost:5000/cb", "https://127.0.0.1/cb", "http://example.com/cb", "nope"]) {
    assert.throws(() => checkRedirectUri(bad), /redirect/);
  }
});

test("callback: code, denied, and a state we didn't start", () => {
  assert.equal(readCallback("/spotify/callback?code=c1&state=abc", "abc"), "c1");
  assert.throws(() => readCallback("/spotify/callback?error=access_denied&state=abc", "abc"), (e) => e.code === "denied");
  assert.throws(() => readCallback("/spotify/callback?code=c1&state=evil", "abc"), (e) => e.code === "state_mismatch");
  assert.throws(() => readCallback("/spotify/callback?state=abc", "abc"), (e) => e.code === "no_code");
});

test("code exchange sends the verifier, not a secret", async () => {
  const { calls, fetchImpl } = tokenFetch([[200, { access_token: "a1", refresh_token: "r1", expires_in: 3600 }]]);
  const result = await exchangeCode({ clientId, code: "c1", redirectUri, verifier: "v1", fetchImpl });
  assert.deepEqual(result, { accessToken: "a1", refreshToken: "r1", expiresInMs: 3_600_000 });
  assert.equal(calls[0].url, "https://accounts.spotify.com/api/token");
  assert.equal(calls[0].body.get("grant_type"), "authorization_code");
  assert.equal(calls[0].body.get("code_verifier"), "v1");
  assert.equal(calls[0].body.has("client_secret"), false);
});

test("revoked refresh token asks for sign-in again without echoing the token", async () => {
  const { fetchImpl } = tokenFetch([[400, { error: "invalid_grant" }]]);
  await assert.rejects(refreshAccessToken({ clientId, refreshToken: "secret-r", fetchImpl }), (e) => e.code === "reauth_needed" && !e.message.includes("secret-r"));
  await assert.rejects(refreshAccessToken({ clientId, refreshToken: null, fetchImpl }), (e) => e.code === "reauth_needed");
  const other = tokenFetch([[500, {}]]);
  await assert.rejects(refreshAccessToken({ clientId, refreshToken: "r", fetchImpl: other.fetchImpl }), (e) => e.code === "token_failed");
});

test("token source caches, refreshes before expiry, saves rotated refresh tokens", async () => {
  let stored = "r1";
  let t = 0;
  const { calls, fetchImpl } = tokenFetch([
    [200, { access_token: "a1", expires_in: 3600 }],
    [200, { access_token: "a2", refresh_token: "r2", expires_in: 3600 }],
  ]);
  const source = createSpotifyTokenSource({ clientId, readRefreshToken: async () => stored, saveRefreshToken: async (v) => { stored = v; }, fetchImpl, now: () => t });
  const [x, y] = await Promise.all([source.getAccessToken(), source.getAccessToken()]);
  assert.equal(x, "a1");
  assert.equal(y, "a1");
  assert.equal(calls.length, 1);
  t = 3_540_000 - 1;
  assert.equal(await source.getAccessToken(), "a1");
  t = 3_540_000;
  assert.equal(await source.getAccessToken(), "a2");
  assert.equal(stored, "r2");
  assert.equal(calls[1].body.get("refresh_token"), "r1");
});
