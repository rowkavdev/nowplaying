import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  normalizeServerUrl, pollJellyfinQuickConnect, pollPlexPin, signInEmby, signInNavidrome, SignInError,
  startJellyfinQuickConnect, startPlexPin,
} from "../src/provider-signin.js";

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const key = `${init.method ?? "GET"} ${url.split("?")[0]}`;
    const route = routes[key];
    if (!route) throw new TypeError(`unexpected ${key}`);
    const { status = 200, body } = typeof route === "function" ? route(url, init) : route;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

const rejectsWith = (promise, status) => assert.rejects(promise, (error) => error instanceof SignInError && error.status === status);

test("Plex PIN: start gives an approval link, poll waits then returns the account", async () => {
  let approved = false;
  const net = fakeFetch({
    "POST https://plex.tv/api/v2/pins": { body: { id: 42, code: "abcd1234" } },
    "GET https://plex.tv/api/v2/pins/42": () => ({ body: approved ? { id: 42, authToken: "plex-token" } : { id: 42, authToken: null } }),
    "GET https://plex.tv/api/v2/user": { body: { id: 987, username: "rowan" } },
  });
  const pin = await startPlexPin({ clientId: "install-1", fetchImpl: net.fetchImpl });
  assert.equal(pin.pinId, 42);
  const link = new URL(pin.authUrl);
  assert.equal(link.origin, "https://app.plex.tv");
  assert.match(pin.authUrl, /clientID=install-1&code=abcd1234/);
  assert.equal(net.calls[0].init.headers["X-Plex-Client-Identifier"], "install-1");
  assert.equal(net.calls[0].init.redirect, "error");
  assert.deepEqual(await pollPlexPin({ clientId: "install-1", pinId: 42, fetchImpl: net.fetchImpl }), { status: "pending" });
  approved = true;
  const done = await pollPlexPin({ clientId: "install-1", pinId: 42, fetchImpl: net.fetchImpl });
  assert.deepEqual(done, { status: "signed_in", provider: "plex", identity: { id: "987", displayName: "rowan" }, secret: "plex-token" });
  assert.equal(net.calls.at(-1).init.headers["X-Plex-Token"], "plex-token");
});

test("Plex PIN: an expired PIN and an offline plex.tv are reported distinctly", async () => {
  const expired = fakeFetch({ "GET https://plex.tv/api/v2/pins/7": { status: 404 } });
  await rejectsWith(pollPlexPin({ clientId: "c", pinId: 7, fetchImpl: expired.fetchImpl }), "expired");
  await rejectsWith(startPlexPin({ clientId: "c", fetchImpl: async () => { throw new TypeError("fetch failed"); } }), "unreachable");
  await rejectsWith(startPlexPin({ clientId: "", fetchImpl: async () => ({}) }), "invalid_client_id");
});

test("Jellyfin Quick Connect: shows a code, then trades the approved secret for a token", async () => {
  let approved = false;
  const net = fakeFetch({
    "POST http://192.168.1.5:8096/QuickConnect/Initiate": { body: { Secret: "s3cret", Code: "123456", Authenticated: false } },
    "GET http://192.168.1.5:8096/QuickConnect/Connect": () => ({ body: { Authenticated: approved } }),
    "POST http://192.168.1.5:8096/Users/AuthenticateWithQuickConnect": { body: { AccessToken: "jf-token", User: { Id: "u-1", Name: "Rowan" } } },
  });
  const options = { baseUrl: "http://192.168.1.5:8096/", deviceId: "install-1", version: "0.2.0", fetchImpl: net.fetchImpl };
  assert.deepEqual(await startJellyfinQuickConnect(options), { secret: "s3cret", code: "123456" });
  assert.match(net.calls[0].init.headers.Authorization, /^MediaBrowser Client="nowplaying", Device="Windows", DeviceId="install-1", Version="0.2.0"$/);
  assert.deepEqual(await pollJellyfinQuickConnect({ ...options, secret: "s3cret" }), { status: "pending" });
  approved = true;
  const done = await pollJellyfinQuickConnect({ ...options, secret: "s3cret" });
  assert.deepEqual(done, { status: "signed_in", provider: "jellyfin", identity: { id: "u-1", displayName: "Rowan" }, secret: "jf-token" });
  assert.deepEqual(JSON.parse(net.calls.at(-1).init.body), { Secret: "s3cret" });
});

test("Jellyfin Quick Connect: disabled on the server and unknown secrets have clear statuses", async () => {
  const disabled = fakeFetch({ "POST http://jf.local:8096/QuickConnect/Initiate": { status: 401 } });
  await rejectsWith(startJellyfinQuickConnect({ baseUrl: "http://jf.local:8096", deviceId: "d", fetchImpl: disabled.fetchImpl }), "quick_connect_disabled");
  const gone = fakeFetch({ "GET http://jf.local:8096/QuickConnect/Connect": { status: 404 } });
  await rejectsWith(pollJellyfinQuickConnect({ baseUrl: "http://jf.local:8096", deviceId: "d", secret: "old", fetchImpl: gone.fetchImpl }), "expired");
});

test("Emby: username and password sign-in returns the user's access token", async () => {
  const net = fakeFetch({ "POST https://emby.example.com/Users/AuthenticateByName": { body: { AccessToken: "emby-token", User: { Id: "e-9", Name: "rowan" } } } });
  const done = await signInEmby({ baseUrl: "https://emby.example.com", username: "rowan", password: "pw", deviceId: "install-1", fetchImpl: net.fetchImpl });
  assert.deepEqual(done, { provider: "emby", identity: { id: "e-9", displayName: "rowan" }, secret: "emby-token" });
  assert.deepEqual(JSON.parse(net.calls[0].init.body), { Username: "rowan", Pw: "pw" });
  assert.match(net.calls[0].init.headers["X-Emby-Authorization"], /^Emby Client="nowplaying"/);
  const wrong = fakeFetch({ "POST https://emby.example.com/Users/AuthenticateByName": { status: 401 } });
  await rejectsWith(signInEmby({ baseUrl: "https://emby.example.com", username: "rowan", password: "bad", deviceId: "d", fetchImpl: wrong.fetchImpl }), "authentication_failed");
});

test("Navidrome: stores a salted token, never the password", async () => {
  const net = fakeFetch({ "GET http://127.0.0.1:4533/rest/ping.view": { body: { "subsonic-response": { status: "ok" } } } });
  const done = await signInNavidrome({ baseUrl: "http://127.0.0.1:4533", username: "rowan", password: "hunter2", salt: "abc", fetchImpl: net.fetchImpl });
  const expected = createHash("md5").update("hunter2abc").digest("hex");
  assert.deepEqual(done.identity, { id: "rowan", displayName: "rowan" });
  assert.deepEqual(JSON.parse(done.secret), { token: expected, salt: "abc" });
  assert.ok(!done.secret.includes("hunter2"));
  const query = new URL(net.calls[0].url).searchParams;
  assert.equal(query.get("t"), expected);
  assert.equal(query.get("p"), null);
  const wrong = fakeFetch({ "GET http://127.0.0.1:4533/rest/ping.view": { body: { "subsonic-response": { status: "failed", error: { code: 40, message: "Wrong username or password" } } } } });
  await rejectsWith(signInNavidrome({ baseUrl: "http://127.0.0.1:4533", username: "rowan", password: "x", fetchImpl: wrong.fetchImpl }), "authentication_failed");
});

test("errors never carry server text or secrets", async () => {
  const leaky = fakeFetch({ "POST https://emby.example.com/Users/AuthenticateByName": { status: 500, body: { message: "token=abc host=10.0.0.2" } } });
  const error = await signInEmby({ baseUrl: "https://emby.example.com", username: "u", password: "hunter2", deviceId: "d", fetchImpl: leaky.fetchImpl }).catch((e) => e);
  assert.equal(error.status, "connection_failed");
  assert.doesNotMatch(error.message, /hunter2|10\.0\.0\.2|token/);
});

test("server URLs must be plain http(s) with no credentials or query", () => {
  assert.equal(normalizeServerUrl(" http://host:8096/jellyfin/ "), "http://host:8096/jellyfin");
  for (const bad of ["ftp://host", "http://user:pw@host", "http://host/?x=1", "javascript:alert(1)", "", "not a url"]) {
    assert.throws(() => normalizeServerUrl(bad), (error) => error.status === "invalid_server_url", bad);
  }
});
