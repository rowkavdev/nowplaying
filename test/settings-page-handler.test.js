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
  assert.doesNotMatch(page.body, /<script>|\sstyle=|\son[a-z]+=/);
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
