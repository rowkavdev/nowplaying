import test from "node:test";
import assert from "node:assert/strict";
import { createAppStatus } from "../src/app-status.js";
import { createDiscordClient } from "../src/discord-client.js";
import { createStatusPageHandler } from "../src/status-page-handler.js";
import { createCardHandler } from "../src/http-handler.js";
import { runInNewContext } from "node:vm";

const config = { provider: "jellyfin", serverUrl: "http://user:pw@192.168.1.5:8096/jf?api_key=secret", identity: { id: "u1", displayName: "Rowan" } };

test("status preserves the successful publish timestamp from the real Discord client contract", async () => {
  const timestamp = Date.parse("2026-10-10T14:30:45.123Z");
  const discord = createDiscordClient({ transport: { connect: async () => {}, setActivity: async () => {}, clearActivity: async () => {} }, now: () => timestamp });
  const status = createAppStatus({ config });
  status.setDiscord(() => ({ enabled: true, ...discord.status() }));
  assert.equal(status.snapshot().discord.lastPublishedAt, null);
  assert.equal(await discord.publish({ details: "Example Song", state: "Example Artist" }), true);
  assert.equal(status.snapshot().discord.state, "ready");
  assert.equal(status.snapshot().discord.lastPublishedAt, "2026-10-10T14:30:45.123Z");
  await discord.close();
});

test("status timestamps accept ISO zones and dates and safely drop invalid values", () => {
  const status = createAppStatus({ config });
  for (const [value, expected] of [[new Date(1000), "1970-01-01T00:00:01.000Z"], [1000, "1970-01-01T00:00:01.000Z"], ["2026-10-10T15:30:45+01:00", "2026-10-10T14:30:45.000Z"], ["2024-02-29T00:00:00.1Z", "2024-02-29T00:00:00.100Z"]]) {
    status.setDiscord(() => ({ lastPublishedAt: value }));
    assert.equal(status.snapshot().discord.lastPublishedAt, expected);
  }
  for (const value of [null, undefined, NaN, Infinity, 8.64e15 + 1, new Date(NaN), {}, "not a date", "1000", "2026-10-10", "2026-10-10T15:30:45", "2026-02-29T00:00:00Z", "2026-02-30T00:00:00Z", "2026-13-10T00:00:00Z", "2026-10-10T24:00:00Z", "2026-10-10T00:00:00+25:00"]) {
    status.setDiscord(() => ({ lastPublishedAt: value }));
    assert.equal(status.snapshot().discord.lastPublishedAt, null, String(value));
  }
});

test("status starts as checking and records a good poll", async () => {
  let t = 1000;
  const status = createAppStatus({ config, version: "0.1.1-dev", now: () => t, elapsedNow: () => t });
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
  const status = createAppStatus({ config, now: () => t, elapsedNow: () => t, refreshAfterMs: 15000 });
  status.wrapProvider({ getPresence: async () => { calls += 1; return { state: "idle" }; } });
  await Promise.all([status.refresh(), status.refresh()]);
  assert.equal(calls, 1);
  t = 10000; await status.refresh(); assert.equal(calls, 1);
  t = 20000; await status.refresh(); assert.equal(calls, 2);
});

test("older playing poll finishing after newer idle cannot restore status playback", async () => {
  let t = 1000, calls = 0, release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const status = createAppStatus({ config, now: () => t });
  const provider = status.wrapProvider({ getPresence: async () => ++calls === 1 ? barrier : { state: "idle" } });
  const old = provider.getPresence();
  await Promise.resolve();
  t = 2000;
  assert.deepEqual(await provider.getPresence(), { state: "idle" });
  assert.equal(status.snapshot().playing, null);
  assert.equal(status.snapshot().server.lastPollAt, new Date(2000).toISOString());
  t = 3000;
  release({ state: "playing", title: "OLD" });
  assert.equal((await old).title, "OLD", "provider result still reaches the original caller");
  const snapshot = status.snapshot();
  assert.equal(snapshot.playing, null);
  assert.equal(snapshot.server.lastPollAt, new Date(2000).toISOString());
  assert.equal(snapshot.server.lastOkAt, new Date(2000).toISOString());
});

test("older failure cannot mark a newer successful provider poll failed", async () => {
  let t = 1000, calls = 0, rejectOld;
  const barrier = new Promise((_, reject) => { rejectOld = reject; });
  const status = createAppStatus({ config, now: () => t });
  const provider = status.wrapProvider({ getPresence: async () => ++calls === 1 ? barrier : { state: "playing", title: "NEW" } });
  const old = provider.getPresence();
  await Promise.resolve();
  t = 2000;
  await provider.getPresence();
  t = 3000;
  rejectOld(Object.assign(new Error("old auth error"), { status: 401 }));
  await assert.rejects(old);
  const snapshot = status.snapshot();
  assert.equal(snapshot.playing.title, "NEW");
  assert.equal(snapshot.server.state, "connected");
  assert.equal(snapshot.server.lastPollAt, new Date(2000).toISOString());
  assert.equal(status.diagnostics().provider.status, "connected");
});

test("older successful poll cannot clear a newer failure", async () => {
  let t = 1000, calls = 0, release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const status = createAppStatus({ config, now: () => t });
  const provider = status.wrapProvider({ getPresence: async () => ++calls === 1 ? barrier : Promise.reject(Object.assign(new Error("new failure"), { status: 401 })) });
  const old = provider.getPresence();
  await Promise.resolve();
  t = 2000;
  await assert.rejects(provider.getPresence());
  t = 3000;
  release({ state: "playing", title: "OLD" });
  await old;
  const snapshot = status.snapshot();
  assert.equal(snapshot.server.state, "authentication_failed");
  assert.equal(snapshot.playing, null);
  assert.equal(snapshot.server.lastPollAt, new Date(2000).toISOString());
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

test("status page's first card refresh loads current SVG without relaxing card options", async () => {
  const status = createAppStatus({ config });
  const card = createCardHandler({ resolveCard: async () => `<svg><text>${title}</text></svg>`, cacheControl: "no-store" });
  const handler = createStatusPageHandler({ status, fallback: card });
  let title = "Before";
  const first = await handler({ url: "/card.svg" });
  assert.equal(first.status, 200);
  assert.match(first.body, /Before/);
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, { textContent: "", className: "", hidden: false, src: "", addEventListener() {}, replaceChildren() {} });
    return nodes.get(id);
  };
  let load;
  const script = (await handler({ url: "/status.js" })).body;
  runInNewContext(script, {
    document: { getElementById: get, createElement: () => ({ textContent: "" }) },
    fetch: async () => ({ ok: true, json: async () => status.snapshot() }),
    Date: { now: () => 1_800_000_000_000, parse: Date.parse },
    setInterval: (fn) => { load = fn; },
    navigator: { clipboard: { writeText: async () => {} } },
  });
  assert.equal(typeof load, "function");
  title = "After";
  await load(); await load(); await load();
  assert.equal(get("card").src, "/card.svg?t=1800000000000");
  const refreshed = await handler({ url: get("card").src });
  assert.equal(refreshed.status, 200);
  assert.match(refreshed.body, /After/);
  assert.equal(refreshed.headers["Cache-Control"], "no-store");
  assert.equal((await handler({ url: "/card.svg?t=1800000000000&debug=true" })).status, 400);
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
  const status = createAppStatus({ config, now: () => t, elapsedNow: () => t });
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

test("tray staleness runs on the elapsed clock through a backward wall jump (#771)", async () => {
  let wall = 1_000_000;
  let elapsed = 1_000_000;
  const status = createAppStatus({ config, now: () => wall, elapsedNow: () => elapsed });
  const provider = status.wrapProvider({ getPresence: async () => ({ state: "playing", title: "A" }) });
  await provider.getPresence();
  assert.equal(status.tray().status, "healthy");
  elapsed += 130_000;
  wall += 130_000 - 3_600_000;
  assert.deepEqual(status.tray(), { status: "degraded", action: "open_troubleshooting", text: "NowPlaying: no update from the server lately" });
  assert.equal(status.snapshot().server.lastOkAt, new Date(1_000_000).toISOString());
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

test("status lists every server with a safe per-server state (#252)", () => {
  const multi = { ...config, servers: [{ serverUrl: config.serverUrl }, { serverUrl: "http://10.0.0.9:4533/" }] };
  const status = createAppStatus({ config: multi, now: () => 5000 });
  assert.deepEqual(status.snapshot().servers, []);
  status.setServers(() => [
    { provider: "jellyfin", displayName: "Rowan", state: "playing", checkedAt: 4000 },
    { provider: "navidrome", displayName: "rowan", state: "unavailable", reason: "CREDENTIAL_MISSING", checkedAt: null },
  ]);
  const rows = status.snapshot().servers;
  assert.deepEqual(rows.map((r) => [r.type, r.user, r.state, r.reason]), [["Jellyfin", "Rowan", "playing", null], ["Navidrome", "rowan", "unavailable", "credential_missing"]]);
  assert.doesNotMatch(JSON.stringify(rows), /pw|api_key|secret/);
  assert.equal(rows[1].address, "http://10.0.0.9:4533");
  assert.throws(() => status.setServers("x"), /expected a function/);
  status.setServers(() => { throw new Error("boom"); });
  assert.deepEqual(status.snapshot().servers, []);
});

test("the status page previews the exact diagnostics report before copying (#141)", async () => {
  const status = createAppStatus({ config });
  const handle = createStatusPageHandler({ status, fallback: async () => ({ status: 404, headers: {}, body: "" }) });
  const page = (await handle({ method: "GET", url: "/status" })).body;
  assert.match(page, /<details id="diagnostics-details"><summary>See exactly what's in the report<\/summary><pre id="diagnostics-preview">/);
  const script = (await handle({ method: "GET", url: "/status.js" })).body;
  assert.match(script, /diagnostics-details"\)\.addEventListener\("toggle"/);
  assert.doesNotThrow(() => new Function(script));
});

test("status refresh interval follows the elapsed clock across a wall-clock correction (#736)", async () => {
  let wall = 1_800_000_000_000, elapsed = 1_800_000_000_000, count = 0;
  const provider = { getPresence: async () => { count += 1; return { state: "playing", title: `Title-${count}` }; } };
  const status = createAppStatus({ config, now: () => wall, elapsedNow: () => elapsed, refreshAfterMs: 15000 });
  status.wrapProvider(provider);
  await status.refresh();
  wall -= 3_600_000; elapsed += 60_000; // wall clock jumps back an hour; 60 elapsed seconds pass
  await status.refresh();
  assert.equal(count, 2);
  assert.equal(status.snapshot().playing.title, "Title-2");
});

test("the card cover status reports a short allow-listed reason and nothing else", () => {
  const status = createAppStatus({ config: { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { displayName: "Rowan" } } });
  assert.equal(status.snapshot().cardArtwork, null);
  status.setCardArtwork(() => ({ state: "failed", reason: "too_large", detail: "http://secret.example/?token=abc" }));
  assert.deepEqual({ ...status.snapshot().cardArtwork }, { state: "failed", reason: "too_large" });
  status.setCardArtwork(() => ({ state: "failed", reason: "http://secret.example/?token=abc" }));
  assert.equal(status.snapshot().cardArtwork.reason, "unknown");
});

test("a provider id that names an Object.prototype property is shown as its own text, not a function", () => {
  const status = createAppStatus({ config: { ...config, provider: "constructor" }, version: "0.1.1-dev" });
  assert.equal(status.snapshot().server.type, "constructor");
});
