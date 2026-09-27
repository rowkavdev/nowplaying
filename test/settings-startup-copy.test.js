import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { createSettingsPageHandler } from "../src/settings-page-handler.js";

// Platform-aware startup copy (#677): the control drives a Windows shortcut,
// a macOS LaunchAgent or an XDG autostart entry, so Unix users must not see
// Windows wording, and the toolbar hint and the lower form must agree.

const handlerFor = (platform) => createSettingsPageHandler({
  settings: { read: () => ({}), updateDiscord: async () => {} },
  fallback: async () => ({ status: 299 }),
  platform,
});

const pageHtml = async (platform) => (await handlerFor(platform)({ url: "/settings" })).body;
const pageScript = async (platform) => (await handlerFor(platform)({ url: "/settings.js" })).body;

test("win32 keeps the existing Windows wording", async () => {
  const html = await pageHtml("win32");
  assert.match(html, /<h2 id="h-startup">Windows<\/h2>/);
  assert.match(html, /Start NowPlaying when I sign in to Windows/);
  const script = await pageScript("win32");
  assert.match(script, /Startup shortcut needs repair - use the Windows section below\./);
  assert.match(script, /Startup shortcut points to another install\./);
});

test("linux renders login wording with no Windows references", async () => {
  const html = await pageHtml("linux");
  assert.match(html, /<h2 id="h-startup">Startup<\/h2>/);
  assert.match(html, /Start NowPlaying at login/);
  assert.doesNotMatch(html, /sign in to Windows/);
  assert.doesNotMatch(html, /Windows section/);
  const script = await pageScript("linux");
  // The API field stays shortcutBroken (#677 scope is the copy), so assert on
  // the user-visible phrases only.
  assert.doesNotMatch(script, /Startup shortcut/);
  assert.doesNotMatch(script, /Windows section/);
  assert.match(script, /The autostart entry points to another install\./);
});

test("darwin renders login wording and names the LaunchAgent", async () => {
  const html = await pageHtml("darwin");
  assert.match(html, /<h2 id="h-startup">Startup<\/h2>/);
  assert.match(html, /Start NowPlaying at login/);
  assert.doesNotMatch(html, /sign in to Windows/);
  const script = await pageScript("darwin");
  assert.doesNotMatch(script, /Startup shortcut/);
  assert.doesNotMatch(script, /Windows section/);
  assert.match(script, /The saved LaunchAgent points to another install\./);
});

// Runs the real served /settings.js in a stub DOM, as in
// settings-autostart-sync.test.js, so the repair copy both controls show is
// exercised by the actual handlers rather than matched in source.
async function page(platform, startup) {
  const h = handlerFor(platform);
  const script = (await h({ url: "/settings.js" })).body;
  const state = { startup };
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
  const fetch = async (path) => {
    if (path === "/api/settings") {
      return { ok: true, json: async () => ({ discord: { enabled: true, timestamps: "both", artworkLookup: "off", idleBehavior: "clear" }, startup: state.startup, privacy: null, card: null, hosted: null }) };
    }
    return { ok: true, json: async () => ({ events: [], servers: [], firstRun: false }) };
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
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
  return { node };
}

const broken = { available: true, startWithWindows: true, shortcutBroken: true };

test("broken Windows shortcut: toolbar hint and lower form agree on the shortcut wording", async () => {
  const { node } = await page("win32", broken);
  assert.equal(node("drpp-autostart-result").textContent, "Startup shortcut needs repair - use the Windows section below.");
  assert.equal(node("startup-result").textContent, "Startup shortcut points to another install. Check the box and Save to fix it.");
});

test("broken XDG entry: toolbar hint and lower form agree, with no Windows wording", async () => {
  const { node } = await page("linux", broken);
  assert.equal(node("drpp-autostart-result").textContent, "Startup entry needs repair - use the Startup section below.");
  assert.equal(node("startup-result").textContent, "The autostart entry points to another install. Check the box and Save to fix it.");
});

test("broken LaunchAgent: toolbar hint and lower form agree, with no Windows wording", async () => {
  const { node } = await page("darwin", broken);
  assert.equal(node("drpp-autostart-result").textContent, "Startup entry needs repair - use the Startup section below.");
  assert.equal(node("startup-result").textContent, "The saved LaunchAgent points to another install. Check the box and Save to fix it.");
});
