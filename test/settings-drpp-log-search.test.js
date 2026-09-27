import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { createSettingsPageHandler } from "../src/settings-page-handler.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function page(preferences = new Map(), writable = true) {
  const h = createSettingsPageHandler({ settings: { read: () => ({ discord: {} }), updateDiscord: async () => {} }, fallback: async () => ({ status: 299 }) });
  const script = (await h({ url: "/settings.js" })).body;
  const elements = new Map();
  const node = (id) => {
    if (!elements.has(id)) {
      const el = { id, value: "", hidden: false, checked: id === "drpp-auto-scroll", textContent: "", className: "",
        children: [], listeners: {}, scrollTop: 0, scrollHeight: 0,
        classList: { toggle() {}, add() {}, remove() {} },
        addEventListener(event, fn) { this.listeners[event] = fn; },
        setAttribute() {}, removeAttribute() {}, replaceChildren(...c) { this.children = c; },
        append(...c) { this.children.push(...c); }, focus() {} };
      el.parentElement = { hidden: false };
      elements.set(id, el);
    }
    return elements.get(id);
  };
  const logs = [
    { time: "2026-09-27T17:00:00Z", level: "warn", component: "provider", status: "Plex timed out", code: "timeout" },
    { time: "2026-09-27T17:01:00Z", level: "info", component: "startup", status: "Ready", code: "" },
    { time: "2026-09-27T17:02:00Z", level: "warn", component: "provider", status: "Jellyfin timed out", code: "timeout" },
  ];
  const localStorage = { getItem: (key) => preferences.get(key) ?? null, setItem(key, value) { if (!writable) throw new Error("storage unavailable"); preferences.set(key, value); } };
  const fetch = async (path) => ({ ok: true, json: async () => path === "/api/logs" ? { events: logs } : path === "/api/settings" ? { discord: { enabled: false } } : { version: "0.2.0", server: { state: "connected", type: "Jellyfin" }, servers: [] } });
  runInNewContext(script, {
    document: {
      getElementById: node, querySelectorAll: () => [],
      createElement: (tag) => ({ tag, className: "", textContent: "", children: [],
        append(...c) { this.children.push(...c); }, setAttribute() {}, addEventListener() {} }),
    },
    fetch, localStorage, MutationObserver: class { observe() {} }, setInterval: () => 1, clearInterval: () => {},
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; }, clearTimeout,
    location: { port: "", protocol: "http:", assign() {} }, navigator: { clipboard: { writeText: async () => {} } }, URL, URLSearchParams, console,
  });
  await tick(); await tick(); await tick();
  return node;
}

test("DRPP log search supports literal regex, slash-delimited flags and a stable total", async () => {
  const n = await page();
  const search = n("drpp-search");
  assert.equal(n("drpp-log-count").textContent, "3 entries");
  search.value = "Plex|Jellyfin"; search.listeners.input();
  assert.equal(n("drpp-log-count").textContent, "2 entries (3 total)");
  search.value = "/timed out/gi"; search.listeners.input();
  assert.equal(n("drpp-log-count").textContent, "2 entries (3 total)", "global regex must match every row");
  search.value = "/\\[WARN\\]/i"; search.listeners.input();
  assert.equal(n("drpp-log-count").textContent, "2 entries (3 total)", "flags and DRPP-style [level] fields work");
  search.value = "["; search.listeners.input();
  assert.equal(n("drpp-log-error").hidden, false);
  assert.equal(n("drpp-log-count").textContent, "2 entries (3 total)", "invalid search keeps the last valid results");
  search.value = ""; search.listeners.input();
  assert.equal(n("drpp-log-error").hidden, true);
  assert.equal(n("drpp-log-count").textContent, "3 entries");
});

test("DRPP log display preferences survive a reload and render before log fetch", async () => {
  const preferences = new Map();
  let n = await page(preferences);
  assert.equal(n("drpp-auto-scroll").checked, true);
  assert.equal(n("drpp-wrap").checked, false);
  n("drpp-auto-scroll").checked = false; n("drpp-auto-scroll").listeners.change();
  n("drpp-wrap").checked = true; n("drpp-wrap").listeners.change();
  assert.equal(preferences.get("logs-auto-scroll"), "false");
  assert.equal(preferences.get("logs-wrap-text"), "true");
  n = await page(preferences);
  assert.equal(n("drpp-auto-scroll").checked, false);
  assert.equal(n("drpp-wrap").checked, true);
  assert.equal(n("drpp-log-count").textContent, "3 entries", "logs still load with restored preferences");
});

test("log controls work if local storage is unavailable", async () => {
  const n = await page(new Map(), false);
  n("drpp-wrap").checked = true;
  assert.doesNotThrow(() => n("drpp-wrap").listeners.change());
  n("drpp-auto-scroll").checked = false;
  assert.doesNotThrow(() => n("drpp-auto-scroll").listeners.change());
});
