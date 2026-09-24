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
    assert.doesNotMatch(page.body, /<script\b[^>]*>[^<]|\sstyle=|\son[a-z]+=/i);
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

test("status colours avoid red/green pairs", async () => {
  const css = (await handler()({ method: "GET", url: "/status.css" })).body;
  for (const hex of css.match(/#[0-9a-f]{6}/gi)) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const greenish = g > r + 40 && g > b + 40;
    const reddish = r > g + 80 && r > b + 80 && g < 80;
    assert.ok(!greenish && !reddish, hex);
  }
});

test("diagnostics export keeps only safe labels and scrubs private values (#115)", async () => {
  const status = createAppStatus({ config, version: "0.1.1-dev", platform: "win32", packageType: "installer" });
  status.setDiscord(() => ({ enabled: true, state: "ready", lastError: null }));
  const provider = status.wrapProvider({ getPresence: async () => ({ state: "playing", title: "Secret Song", subtitle: "Private Artist" }) });
  await provider.getPresence();
  const record = status.diagnostics();
  assert.deepEqual(record, {
    schemaVersion: 1,
    version: "0.1.1-dev",
    platform: "win32",
    packageType: "installer",
    enabledOutputs: ["card", "discord"],
    provider: { type: "jellyfin", status: "connected" },
    health: "healthy",
    updater: null,
    tray: null,
    errors: [],
    build: null,
  });
  const json = JSON.stringify(record);
  for (const leak of ["Rowan", "192.168", "secret", "Secret Song", "Private Artist", "pw"]) assert.equal(json.includes(leak), false, leak);
});

test("diagnostics endpoint is same-origin only and downloads as a file", async () => {
  const status = createAppStatus({ config, version: "0.1.1-dev", platform: "win32" });
  const handle = createStatusPageHandler({ status, fallback: async () => ({ status: 404, headers: {}, body: "" }) });
  const ok = await handle({ method: "GET", url: "/api/diagnostics", headers: { "Sec-Fetch-Site": "same-origin" } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers["Content-Disposition"], /attachment/);
  assert.equal(JSON.parse(ok.body).health, "starting");
  const cross = await handle({ method: "GET", url: "/api/diagnostics", headers: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(cross.status, 403);
  const post = await handle({ method: "POST", url: "/api/diagnostics" });
  assert.equal(post.status, 405);
  const page = await handle({ method: "GET", url: "/status" });
  assert.match(page.body, /Copy diagnostics/);
});

test("status and diagnostics show validated build details (#119)", () => {
  const build = { version: "0.1.1", commitSha: "227ababbbe9bc4cfe34d80417ca3298d28194bf8", buildTime: "2026-09-23T22:18:09.000Z", channel: "development", signed: false };
  const status = createAppStatus({ config, version: "0.1.1", build, packageType: "installer" });
  assert.deepEqual(status.snapshot().build, { commit: "227abab", builtAt: "2026-09-23T22:18:09.000Z", channel: "development", signed: false });
  assert.deepEqual(status.diagnostics().build, build);
  assert.equal(status.diagnostics().packageType, "installer");
  const broken = createAppStatus({ config, build: { version: "x", commitSha: "nope" } });
  assert.equal(broken.snapshot().build, null);
  assert.equal(broken.diagnostics().build, null);
});

test("tray line is short, private and follows the app's health (#121)", async () => {
  let t = 1_000_000;
  let discordState = { enabled: true, state: "ready" };
  const status = createAppStatus({ config, now: () => t });
  status.setDiscord(() => discordState);
  assert.deepEqual(status.tray(), { status: "starting", action: null, text: "NowPlaying: starting..." });
  let fail = false;
  const provider = status.wrapProvider({ getPresence: async () => { if (fail) { const e = new Error("x"); e.status = 401; throw e; } return { state: "playing", title: "Secret Song", subtitle: "Artist" }; } });
  await provider.getPresence();
  assert.equal(status.tray().text, "NowPlaying: working");
  discordState = { enabled: true, state: "disconnected" };
  assert.equal(status.tray().status, "healthy");
  discordState = { enabled: true, state: "failed" };
  assert.equal(status.tray().text, "NowPlaying: Discord needs attention");
  discordState = { enabled: false, state: "off" };
  t += 10 * 60_000;
  assert.equal(status.tray().text, "NowPlaying: no update from the server lately");
  fail = true;
  await assert.rejects(provider.getPresence());
  const line = status.tray();
  assert.deepEqual(line, { status: "degraded", action: "test_provider_connection", text: "NowPlaying: sign-in rejected, run setup" });
  for (const value of [status.tray(), line]) {
    assert.ok(value.text.length <= 63);
    assert.equal(/Secret|Rowan|192\.168/.test(JSON.stringify(value)), false);
  }
});

test("tray endpoint serves the same line", async () => {
  const status = createAppStatus({ config });
  const handle = createStatusPageHandler({ status, fallback: async () => ({ status: 404, headers: {}, body: "" }) });
  const res = await handle({ method: "GET", url: "/api/tray" });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).text, "NowPlaying: starting...");
  assert.equal((await handle({ method: "GET", url: "/api/tray", headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await handle({ method: "GET", url: "/api/tray", headers: { "sec-fetch-site": "same-site" } })).status, 403);
  assert.equal((await handle({ method: "GET", url: "/api/tray", headers: { "sec-fetch-site": "same-origin" } })).status, 200);
  assert.equal((await handle({ method: "GET", url: "/api/tray", headers: { "sec-fetch-site": "none" } })).status, 200);
});

test("discord artwork source and reason are short words only", () => {
  const status = createAppStatus({ config });
  status.setDiscord(() => ({ enabled: true, state: "ready", artwork: { strategy: "fallback", failure: "lookup_miss" } }));
  assert.deepEqual({ ...status.snapshot().discord.artwork }, { source: "fallback", reason: "lookup_miss" });
  status.setDiscord(() => ({ enabled: true, state: "ready", artwork: { strategy: "lookup", failure: null } }));
  assert.deepEqual({ ...status.snapshot().discord.artwork }, { source: "lookup", reason: null });
  status.setDiscord(() => ({ enabled: true, state: "ready", artwork: { strategy: "https://cdn.example/x.png", failure: "private host 10.0.0.2" } }));
  assert.deepEqual({ ...status.snapshot().discord.artwork }, { source: "unknown", reason: "unknown" });
  status.setDiscord(() => ({ enabled: true, state: "ready" }));
  assert.equal(status.snapshot().discord.artwork, undefined);
});
