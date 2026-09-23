import test from "node:test";
import assert from "node:assert/strict";
import { createAppStatus } from "../src/app-status.js";
import { createStatusPageHandler } from "../src/status-page-handler.js";

const config = { provider: "jellyfin", serverUrl: "http://user:pw@192.168.1.5:8096/jf?api_key=secret", identity: { id: "u1", displayName: "Rowan" } };

test("status starts as checking and records a good poll", async () => {
  let t = 1000;
  const status = createAppStatus({ config, version: "0.1.1-dev", now: () => t });
  assert.equal(status.snapshot().server.state, "starting");
  const provider = status.wrapProvider({ getPresence: async () => ({ state: "playing", title: "Song", subtitle: "Artist" }) });
  t = 5000;
  await provider.getPresence();
  const snap = status.snapshot();
  assert.equal(snap.server.state, "connected");
  assert.equal(snap.server.type, "Jellyfin");
  assert.equal(snap.server.address, "http://192.168.1.5:8096");
  assert.equal(snap.server.user, "Rowan");
  assert.equal(snap.server.lastOkAt, new Date(5000).toISOString());
  assert.deepEqual(snap.playing, { state: "playing", title: "Song", subtitle: "Artist" });
  assert.equal(snap.version, "0.1.1-dev");
  assert.equal(snap.uptimeMs, 4000);
});

test("status never leaks credentials or error text", async () => {
  const status = createAppStatus({ config });
  const provider = status.wrapProvider({ getPresence: async () => { const e = new Error("token=abc123 failed"); e.status = 401; throw e; } });
  await assert.rejects(provider.getPresence());
  const json = JSON.stringify(status.snapshot());
  assert.equal(status.snapshot().server.state, "authentication_failed");
  for (const secret of ["pw", "api_key", "secret", "abc123", "token", "u1"]) assert.doesNotMatch(json, new RegExp(secret));
});

test("status maps unreachable servers and clears the track", async () => {
  let fail = false;
  const status = createAppStatus({ config });
  const provider = status.wrapProvider({ getPresence: async () => { if (fail) { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; } return { state: "playing", title: "A" }; } });
  await provider.getPresence();
  fail = true;
  await assert.rejects(provider.getPresence());
  assert.equal(status.snapshot().server.state, "unreachable");
  assert.equal(status.snapshot().playing, null);
  assert.ok(status.snapshot().server.lastOkAt);
});

test("idle presence shows nothing playing", async () => {
  const status = createAppStatus({ config });
  await status.wrapProvider({ getPresence: async () => ({ state: "idle" }) }).getPresence();
  assert.equal(status.snapshot().playing, null);
});

test("refresh polls only when nothing polled recently, and coalesces", async () => {
  let t = 0; let calls = 0;
  const status = createAppStatus({ config, now: () => t, refreshAfterMs: 15000 });
  status.wrapProvider({ getPresence: async () => { calls += 1; return { state: "idle" }; } });
  await Promise.all([status.refresh(), status.refresh()]);
  assert.equal(calls, 1);
  t = 10000; await status.refresh(); assert.equal(calls, 1);
  t = 20000; await status.refresh(); assert.equal(calls, 2);
});

test("refresh swallows provider errors", async () => {
  const status = createAppStatus({ config });
  status.wrapProvider({ getPresence: async () => { throw new Error("boom"); } });
  await status.refresh();
  assert.equal(status.snapshot().server.state, "error");
});

test("discord state is sanitised", () => {
  const status = createAppStatus({ config });
  status.setDiscord(() => ({ enabled: true, state: "ready", lastPublishedAt: 1000, lastError: "DISCORD_PUBLISH_FAILED" }));
  assert.deepEqual({ ...status.snapshot().discord }, { enabled: true, state: "ready", lastPublishedAt: new Date(1000).toISOString(), error: "DISCORD_PUBLISH_FAILED" });
  status.setDiscord(() => ({ enabled: true, state: "<b>", lastError: "raw message here" }));
  assert.deepEqual({ ...status.snapshot().discord }, { enabled: true, state: "unknown", lastPublishedAt: null, error: null });
  status.setDiscord(() => { throw new Error("x"); });
  assert.equal(status.snapshot().discord.state, "unknown");
});

function handler() {
  const status = createAppStatus({ config, version: "9.9.9" });
  status.wrapProvider({ getPresence: async () => ({ state: "playing", title: "T" }) });
  return createStatusPageHandler({ status, fallback: async (r) => ({ status: 299, headers: {}, body: r.url }) });
}

test("status page, assets and api are served; other paths fall through", async () => {
  const h = handler();
  for (const path of ["/", "/status"]) {
    const page = await h({ method: "GET", url: path });
    assert.equal(page.status, 200); assert.equal(page.page, true);
    assert.match(page.body, /<script src="\/status.js"><\/script>/);
    assert.doesNotMatch(page.body, /<script>|\sstyle=|\son[a-z]+=/);
  }
  assert.match((await h({ method: "GET", url: "/status.js" })).headers["Content-Type"], /javascript/);
  assert.match((await h({ method: "GET", url: "/status.css" })).headers["Content-Type"], /css/);
  const api = await h({ method: "GET", url: "/api/status", headers: { "sec-fetch-site": "same-origin" } });
  assert.equal(api.status, 200);
  const body = JSON.parse(api.body);
  assert.equal(body.version, "9.9.9"); assert.equal(body.server.state, "connected"); assert.equal(body.playing.title, "T");
  assert.equal(api.headers["Cache-Control"], "no-store");
  assert.equal((await h({ method: "GET", url: "/card.svg?x=1" })).status, 299);
  assert.equal((await h({ method: "HEAD", url: "/" })).body, "");
});

test("status api refuses cross-site requests and writes", async () => {
  const h = handler();
  for (const site of ["cross-site", "same-site"]) assert.equal((await h({ method: "GET", url: "/api/status", headers: { "Sec-Fetch-Site": site } })).status, 403);
  assert.equal((await h({ method: "POST", url: "/api/status" })).status, 405);
  assert.equal((await h({ method: "GET", url: "/api/status" })).status, 200);
});
