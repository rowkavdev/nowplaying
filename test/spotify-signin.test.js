import test from "node:test";
import assert from "node:assert/strict";
import { signInToSpotify } from "../src/spotify-signin.js";

const clientId = "0123456789abcdef0123456789abcdef";

function tokenFetch(status = 200, body = { access_token: "a1", refresh_token: "r1", expires_in: 3600 }) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, body: new URLSearchParams(init.body) }); return { ok: status < 300, status, json: async () => body }; } };
}

test("signs in through a one-off 127.0.0.1 listener (#135)", async () => {
  const { calls, fetchImpl } = tokenFetch();
  let authorize;
  const done = signInToSpotify({ clientId, fetchImpl, openUrl: async (url) => { authorize = new URL(url); } });
  while (!authorize) await new Promise((r) => setTimeout(r, 5));
  const redirect = new URL(authorize.searchParams.get("redirect_uri"));
  assert.equal(redirect.hostname, "127.0.0.1");
  assert.equal(redirect.pathname, "/spotify/callback");
  const state = authorize.searchParams.get("state");
  const stray = await fetch(`${redirect}?code=x&state=wrong`);
  assert.equal(stray.status, 400);
  const res = await fetch(`${redirect}?code=c1&state=${state}`);
  assert.match(await res.text(), /Spotify connected/);
  assert.deepEqual(await done, { accessToken: "a1", refreshToken: "r1", expiresInMs: 3_600_000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.get("code"), "c1");
  assert.equal(calls[0].body.get("redirect_uri"), redirect.toString());
  await assert.rejects(fetch(redirect), "listener is closed after sign-in");
});

test("cancelled consent and timeout end the sign-in", async () => {
  let authorize;
  const denied = signInToSpotify({ clientId, fetchImpl: tokenFetch().fetchImpl, openUrl: async (url) => { authorize = new URL(url); } });
  const outcome = denied.then(() => null, (e) => e);
  while (!authorize) await new Promise((r) => setTimeout(r, 5));
  await fetch(`${authorize.searchParams.get("redirect_uri")}?error=access_denied&state=${authorize.searchParams.get("state")}`);
  assert.equal((await outcome)?.code, "denied");
  await assert.rejects(signInToSpotify({ clientId, timeoutMs: 20, openUrl: async () => {} }), (e) => e.code === "timeout");
  await assert.rejects(signInToSpotify({ clientId: "bad", openUrl: async () => {} }), /Client ID/);
});
