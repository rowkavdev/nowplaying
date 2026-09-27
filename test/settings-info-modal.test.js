import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { createSettingsPageHandler } from "../src/settings-page-handler.js";

const handler = () => createSettingsPageHandler({ settings: { read: () => ({ discord: {} }), updateDiscord: async () => {} }, fallback: async () => ({ status: 299 }) });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("DRPP Info dialog serves only its three real local project files", async () => {
  const h = handler();
  const page = (await h({ url: "/settings" })).body;
  assert.match(page, /<dialog id="drpp-info"/);
  assert.match(page, /role="tablist"/);
  assert.match(page, /OSS Attribution/);
  assert.doesNotMatch(page, /Info \(coming soon\)/);
  assert.doesNotMatch(page, /\sstyle=|\son[a-z]+=/i);
  for (const name of ["NOTICE", "README.md", "LICENSE"]) {
    const res = await h({ url: "/api/info/" + name });
    assert.equal(res.status, 200);
    assert.equal(res.body, readFileSync(new URL("../" + name, import.meta.url), "utf8"));
    assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
    assert.equal((await h({ method: "HEAD", url: "/api/info/" + name })).body, "");
  }
  for (const path of ["/api/info/COPYRIGHT", "/api/info/%2e%2e%2fsettings", "/api/info/secret"])
    assert.notEqual((await h({ url: path })).status, 200);
  assert.equal((await h({ method: "POST", url: "/api/info/LICENSE" })).status, 405);
  assert.equal((await h({ url: "/api/info/LICENSE", headers: { "sec-fetch-site": "cross-site" } })).status, 403);
});

test("Info dialog opens, swaps tabs using actual responses, and closes", async () => {
  const script = (await handler()({ url: "/settings.js" })).body;
  const infoScript = script.slice(script.indexOf("// DRPP InfoModal:"), script.indexOf("refreshVersion(); refreshLogs();", script.indexOf("// DRPP InfoModal:")));
  const els = new Map();
  const node = (id) => {
    if (!els.has(id)) els.set(id, { id, listeners: {}, textContent: "", attrs: {}, open: false,
      addEventListener(kind, fn) { this.listeners[kind] = fn; },
      setAttribute(name, value) { this.attrs[name] = value; },
      showModal() { this.open = true; }, close() { this.open = false; } });
    return els.get(id);
  };
  const tabs = [["attribution", "NOTICE"], ["readme", "README.md"], ["license", "LICENSE"]].map(([id, file]) => Object.assign(node("drpp-info-" + id), { dataset: { file } }));
  const pending = new Map();
  runInNewContext(infoScript, {
    document: { getElementById: node, querySelectorAll: () => tabs },
    fetch: (url) => new Promise((resolve) => pending.set(url, resolve)),
    Map, Array,
  });
  node("drpp-info-open").listeners.click();
  assert.equal(node("drpp-info").open, true);
  assert.equal(node("drpp-info-content").textContent, "Loading...");
  assert.equal(tabs[0].attrs["aria-selected"], "true");
  tabs[1].listeners.click();
  pending.get("/api/info/README.md")({ ok: true, text: async () => "Readme text" }); await tick();
  assert.equal(node("drpp-info-content").textContent, "Readme text");
  pending.get("/api/info/NOTICE")({ ok: true, text: async () => "Attribution text" }); await tick();
  assert.equal(node("drpp-info-content").textContent, "Readme text", "late request must not overwrite selected tab");
  tabs[0].listeners.click();
  assert.equal(node("drpp-info-content").textContent, "Attribution text", "cached tab displays without a new request");
  node("drpp-info-close").listeners.click();
  assert.equal(node("drpp-info").open, false);
});
