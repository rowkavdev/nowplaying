import test from "node:test";
import assert from "node:assert/strict";
import { createSettingsPageHandler } from "../src/settings-page-handler.js";

function handler(update = async () => {}) {
  let discord = { enabled: true, timestamps: "both", artworkLookup: "off" };
  const settings = { read: () => ({ discord }), updateDiscord: async (changes) => { await update(changes); discord = { ...discord, ...changes }; } };
  return createSettingsPageHandler({ settings, fallback: async () => ({ status: 299 }) });
}
const put = (body, headers = {}) => ({ method: "PUT", url: "/api/settings", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

test("serves the page, style and script, and passes other paths on", async () => {
  const h = handler();
  const page = await h({ url: "/settings" });
  assert.equal(page.status, 200);
  assert.equal(page.page, true);
  assert.match(page.body, /<script src="\/settings.js">/);
  // Only the external script: no inline script, style or event attributes.
  assert.equal(page.body.toLowerCase().split("<script").length, 2);
  assert.doesNotMatch(page.body, /\sstyle=|\son[a-z]+=/i);
  assert.equal((await h({ url: "/settings.js" })).headers["Content-Type"], "text/javascript; charset=utf-8");
  assert.equal((await h({ url: "/settings.css" })).status, 200);
  assert.equal((await h({ method: "HEAD", url: "/settings" })).body, "");
  assert.equal((await h({ method: "POST", url: "/settings" })).status, 405);
  assert.equal((await h({ url: "/card.svg" })).status, 299);
});

test("reads and saves Discord settings", async () => {
  const h = handler();
  assert.deepEqual(JSON.parse((await h({ url: "/api/settings" })).body), { discord: { enabled: true, timestamps: "both", artworkLookup: "off" } });
  const saved = await h(put({ discord: { timestamps: "none" } }));
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(saved.body).discord.timestamps, "none");
  assert.equal((await h({ method: "DELETE", url: "/api/settings" })).status, 405);
});

test("the page offers every idle behaviour and saves it with the Discord form", async () => {
  const h = handler();
  const page = (await h({ url: "/settings" })).body;
  for (const value of ["clear", "grace", "show", "recent"]) assert.match(page, new RegExp('<option value="' + value + '">'));
  assert.match(page, /<label for="discord-idle">When nothing is playing<\/label>/);
  const script = (await h({ url: "/settings.js" })).body;
  assert.match(script, /idleBehavior: fields\.idleBehavior\.value/);
  const saved = await h(put({ discord: { idleBehavior: "recent" } }));
  assert.equal(JSON.parse(saved.body).discord.idleBehavior, "recent");
});

test("refuses other sites, bad JSON and unknown sections", async () => {
  const h = handler();
  assert.equal((await h({ url: "/api/settings", headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await h(put({ discord: { enabled: false } }, { "sec-fetch-site": "same-site" }))).status, 403);
  assert.equal((await h(put("{nope"))).status, 400);
  assert.equal((await h(put("x".repeat(5000)))).status, 400);
  assert.equal((await h(put([]))).status, 400);
  assert.equal((await h(put({}))).status, 400);
  assert.equal((await h(put({ discord: {}, hosted: {} }))).status, 400);
});

test("bad values are 400, a failed save is 500, and neither leaks details", async () => {
  const bad = handler(async () => { throw new TypeError("discord settings: unknown setting"); });
  const rejected = await bad(put({ discord: { token: "s3cret" } }));
  assert.deepEqual([rejected.status, JSON.parse(rejected.body)], [400, { error: "invalid_settings" }]);
  const broken = handler(async () => { throw Object.assign(new Error("EACCES C:\\Users\\rowan\\config.json"), { code: "EACCES" }); });
  const failed = await broken(put({ discord: { enabled: false } }));
  assert.deepEqual([failed.status, JSON.parse(failed.body)], [500, { error: "save_failed" }]);
});

test("needs a settings store and a fallback", () => {
  assert.throws(() => createSettingsPageHandler({ fallback: async () => null }), TypeError);
  assert.throws(() => createSettingsPageHandler({ settings: { read() {}, updateDiscord() {} } }), TypeError);
});

test("hosted: saves the section and disconnects by POST only", async () => {
  let hosted = { enabled: false, state: "off" };
  const calls = [];
  const settings = {
    read: async () => ({ discord: {}, hosted }),
    updateDiscord: async () => {},
    updateHosted: async (changes) => { calls.push("update"); hosted = { ...hosted, ...changes }; },
    disconnectHosted: async () => { calls.push("disconnect"); hosted = { enabled: false, state: "off" }; },
  };
  const h = createSettingsPageHandler({ settings, fallback: async () => null });
  assert.equal(JSON.parse((await h(put({ hosted: { enabled: true } }))).body).hosted.enabled, true);
  assert.equal((await h({ url: "/api/settings/hosted/disconnect" })).status, 405);
  assert.equal((await h({ method: "POST", url: "/api/settings/hosted/disconnect", headers: { "sec-fetch-site": "cross-site" }, body: "{}" })).status, 403);
  const off = await h({ method: "POST", url: "/api/settings/hosted/disconnect", body: "{}" });
  assert.equal(JSON.parse(off.body).hosted.enabled, false);
  assert.deepEqual(calls, ["update", "disconnect"]);
  const failing = createSettingsPageHandler({ settings: { ...settings, disconnectHosted: async () => { throw new Error("offline 10.0.0.2"); } }, fallback: async () => null });
  const failed = await failing({ method: "POST", url: "/api/settings/hosted/disconnect", body: "{}" });
  assert.deepEqual([failed.status, failed.body], [502, '{"error":"disconnect_failed"}']);
  const old = createSettingsPageHandler({ settings: { read: () => ({ discord: {} }), updateDiscord: async () => {} }, fallback: async () => null });
  assert.equal((await old({ method: "POST", url: "/api/settings/hosted/disconnect", body: "{}" })).status, 404);
  assert.equal((await old(put({ hosted: { enabled: true } }))).status, 400);
});

test("refresh artwork: POST only, reports how many covers were dropped", async () => {
  let refreshed = 0;
  const settings = { read: () => ({ discord: {} }), updateDiscord: async () => {}, refreshArtwork: async () => { refreshed += 1; return 4; } };
  const h = createSettingsPageHandler({ settings, fallback: async () => null });
  const done = await h({ method: "POST", url: "/api/settings/discord/refresh-artwork", body: "{}" });
  assert.deepEqual([done.status, JSON.parse(done.body)], [200, { dropped: 4 }]);
  assert.equal(refreshed, 1);
  assert.equal((await h({ url: "/api/settings/discord/refresh-artwork" })).status, 405);
  assert.equal((await h({ method: "POST", url: "/api/settings/discord/refresh-artwork", headers: { "sec-fetch-site": "cross-site" }, body: "{}" })).status, 403);
  const odd = createSettingsPageHandler({ settings: { ...settings, refreshArtwork: async () => "lots" }, fallback: async () => null });
  assert.equal(JSON.parse((await odd({ method: "POST", url: "/api/settings/discord/refresh-artwork", body: "{}" })).body).dropped, 0);
  const broken = createSettingsPageHandler({ settings: { ...settings, refreshArtwork: async () => { throw new Error("cache C:\\x"); } }, fallback: async () => null });
  assert.deepEqual(JSON.parse((await broken({ method: "POST", url: "/api/settings/discord/refresh-artwork", body: "{}" })).body), { error: "refresh_failed" });
  const old = createSettingsPageHandler({ settings: { read: () => ({ discord: {} }), updateDiscord: async () => {} }, fallback: async () => null });
  assert.equal((await old({ method: "POST", url: "/api/settings/discord/refresh-artwork", body: "{}" })).status, 404);
});

test("privacy section: six choices, loaded from and saved to /api/settings (#253)", async () => {
  const page = (await handler()({ url: "/settings" })).body;
  const script = (await handler()({ url: "/settings.js" })).body;
  for (const key of ["hideTitles", "hideArtwork", "hideProgress", "hideMovies", "hideEpisodes", "hideMusic"]) {
    assert.match(page, new RegExp(`id="privacy-${key}"`));
    assert.match(script, new RegExp(`"${key}"`));
  }
  assert.match(script, /showPrivacy\(all\.privacy\)/);
  assert.doesNotThrow(() => new Function(script));
  let privacy = { hideTitles: false, hideArtwork: false, hideProgress: false, hideMovies: false, hideEpisodes: false, hideMusic: false };
  const settings = { read: () => ({ discord: {}, privacy }), updateDiscord: async () => {}, updatePrivacy: async (changes) => { privacy = { ...privacy, ...changes }; } };
  const h = createSettingsPageHandler({ settings, fallback: async () => ({ status: 299 }) });
  const saved = await h(put({ privacy: { hideMusic: true } }));
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(saved.body).privacy.hideMusic, true);
});

test("the page manages servers here instead of opening a wizard", async () => {
  const h = handler();
  const page = (await h({ url: "/settings" })).body;
  assert.match(page, /id="servers-section"/);
  assert.match(page, /id="discover-servers"/);
  assert.match(page, /id="scan-subnet"/);
  assert.match(page, /id="manual-connect"/);
  assert.doesNotMatch(page, /servers-setup/);
  const script = (await h({ url: "/settings.js" })).body;
  assert.match(script, /\/api\/settings\/servers\/discover/);
  assert.match(script, /\/api\/setup\/signin/);
  assert.equal((await h({ method: "POST", url: "/api/settings/servers/setup", body: "{}" })).status, 410);
});
