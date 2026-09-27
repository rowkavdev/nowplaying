import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { createSettingsPageHandler } from "../src/settings-page-handler.js";

const ok = (body) => ({ ok: true, json: async () => body });
const tick = () => new Promise((resolve) => setImmediate(resolve));

// Runs the real served /settings.js in a stub DOM with a stateful fake
// /api/settings, so both startup controls are exercised by their actual
// event handlers rather than by matching source text.
async function page(startup) {
  const h = createSettingsPageHandler({ settings: { read: () => ({}), updateDiscord: async () => {} }, fallback: async () => ({ status: 299 }) });
  const script = (await h({ url: "/settings.js" })).body;
  const state = { startup };
  const requests = [];
  const elements = new Map();
  const node = (id) => {
    if (!elements.has(id)) {
      const el = {
        id, value: "", checked: false, hidden: false, disabled: false, textContent: "", className: "",
        children: [], listeners: {}, scrollTop: 0, scrollHeight: 0,
        classList: { toggle() {}, add() {}, remove() {} },
        addEventListener(event, fn) { this.listeners[event] = fn; },
        setAttribute() {}, removeAttribute() {},
        replaceChildren(...c) { this.children = c; },
        append(...c) { this.children.push(...c); },
        focus() {},
      };
      el.parentElement = { hidden: false };
      elements.set(id, el);
    }
    return elements.get(id);
  };
  const fetch = async (path, options = {}) => {
    const method = options.method || "GET";
    requests.push({ path, method, body: options.body ? JSON.parse(options.body) : null });
    if (path === "/api/settings" && method === "GET") {
      return ok({ discord: { enabled: true, timestamps: "both", artworkLookup: "off", idleBehavior: "clear" }, startup: state.startup, privacy: null, card: null, hosted: null });
    }
    if (path === "/api/settings" && method === "PUT") {
      if (state.failNextPut) { state.failNextPut = false; return { ok: false, json: async () => ({}) }; }
      const body = JSON.parse(options.body);
      // The real save recreates the shortcut, so a successful save repairs it.
      if (body.startup) state.startup = { available: true, startWithWindows: body.startup.startWithWindows, shortcutBroken: false };
      return ok({ startup: state.startup });
    }
    return ok({ events: [], servers: [], firstRun: false });
  };
  runInNewContext(script, {
    document: {
      getElementById: node,
      querySelectorAll: () => [],
      createElement: (tag) => ({ tag, className: "", textContent: "", children: [], append(...c) { this.children.push(...c); }, setAttribute() {}, addEventListener() {} }),
    },
    fetch, localStorage: { getItem: () => null, setItem() {} },
    MutationObserver: class { observe() {} },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; },
    clearTimeout,
    location: { port: "", protocol: "http:", assign() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    URL, URLSearchParams, console,
  });
  await tick(); await tick(); await tick();
  return { node, requests, state };
}

test("toolbar autostart switch loads hidden until startup control is available", async () => {
  const { node } = await page(null);
  assert.equal(node("drpp-autostart-wrap").hidden, true);
  assert.equal(node("drpp-autostart-divider").hidden, true);
});

test("toolbar autostart switch shows the current state and the repair note", async () => {
  const { node } = await page({ available: true, startWithWindows: false, shortcutBroken: true });
  assert.equal(node("drpp-autostart-wrap").hidden, false);
  assert.equal(node("drpp-autostart").checked, false);
  assert.match(node("drpp-autostart-result").textContent, /repair/);
});

test("a toolbar save syncs the Windows checkbox and clears the repair note", async () => {
  const { node, requests } = await page({ available: true, startWithWindows: false, shortcutBroken: true });
  node("drpp-autostart").checked = true;
  await node("drpp-autostart").listeners.change();
  const put = requests.find((r) => r.method === "PUT");
  assert.deepEqual(put.body, { startup: { startWithWindows: true } });
  assert.equal(node("startup-enabled").checked, true, "Windows section checkbox must follow the toolbar save");
  assert.equal(node("drpp-autostart-result").textContent, "", "repair note must clear once the returned state is repaired");
});

test("a Windows section save syncs the toolbar switch and clears its repair note", async () => {
  const { node } = await page({ available: true, startWithWindows: true, shortcutBroken: true });
  assert.equal(node("drpp-autostart").checked, true);
  assert.match(node("drpp-autostart-result").textContent, /repair/);
  node("startup-enabled").checked = false;
  await node("startup-form").listeners.submit({ preventDefault() {} });
  assert.equal(node("drpp-autostart").checked, false, "toolbar switch must follow the Windows section save");
  assert.equal(node("drpp-autostart-result").textContent, "", "toolbar repair note must clear after a successful section save");
  assert.equal(node("startup-result").textContent, "Saved.");
});

test("a failed toolbar save reverts the switch without touching the Windows checkbox", async () => {
  const { node, state } = await page({ available: true, startWithWindows: false, shortcutBroken: true });
  node("drpp-autostart").checked = true;
  state.failNextPut = true;
  await node("drpp-autostart").listeners.change();
  assert.equal(node("drpp-autostart").checked, false, "switch reverts on failure");
  assert.equal(node("startup-enabled").checked, false, "Windows checkbox untouched on failure");
});
