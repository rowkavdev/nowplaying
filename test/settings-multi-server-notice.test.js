import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { createSettingsPageHandler } from "../src/settings-page-handler.js";
import { createMultiServerProvider } from "../src/multi-server.js";
import { createAppStatus } from "../src/app-status.js";

const config = { provider: "plex", serverUrl: "http://127.0.0.1:32400", identity: { id: "u1", displayName: "User" }, servers: [
  { provider: "plex", serverUrl: "http://127.0.0.1:32400", identity: { id: "u1", displayName: "User" } },
  { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u2", displayName: "Other" } },
] };
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function notice(snapshot) {
  const handle = createSettingsPageHandler({ settings: { read: () => ({}), updateDiscord: async () => {} }, fallback: async () => ({ status: 404 }) });
  const script = (await handle({ url: "/settings.js" })).body;
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) {
      const item = { id, value: "", checked: false, hidden: false, disabled: false, textContent: "", className: "", children: [], scrollTop: 0, scrollHeight: 0,
        classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, replaceChildren() {}, append() {}, focus() {} };
      item.parentElement = { hidden: false }; nodes.set(id, item);
    }
    return nodes.get(id);
  };
  runInNewContext(script, {
    document: { getElementById: node, querySelectorAll: () => [], createElement: () => ({ className: "", textContent: "", append() {}, addEventListener() {}, setAttribute() {} }) },
    fetch: async (url) => ({ ok: true, json: async () => url === "/api/status" ? snapshot : url === "/api/settings" ? { discord: { enabled: false, timestamps: "none", artworkLookup: "off" } } : url === "/api/logs" ? { events: [] } : { servers: [], firstRun: false } }),
    MutationObserver: class { observe() {} }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
    location: { port: "", protocol: "http:", assign() {} }, navigator: { clipboard: { writeText: async () => {} } }, URL, URLSearchParams, console,
  });
  for (let i = 0; i < 10 && node("drpp-version").textContent === ""; i++) await tick();
  return node;
}

test("Settings notice names a failed server even when another is playing", async () => {
  for (const failed of [0, 1]) {
    const multi = createMultiServerProvider(config.servers.map((server, index) => ({ server, provider: { getPresence: async () => {
      if (index === failed) throw Object.assign(new Error("private token"), { status: 401 });
      return { state: "playing", title: "private song" };
    } } })));
    const status = createAppStatus({ config });
    status.setServers(() => multi.servers());
    await status.wrapProvider(multi).getPresence();
    const snapshot = status.snapshot();
    assert.equal(snapshot.server.state, "connected");
    assert.equal(snapshot.servers[failed].reason, "unauthorized");
    const get = await notice(snapshot);
    assert.equal(get("drpp-setup").hidden, false);
    assert.equal(get("drpp-setup-title").textContent, "Server Needs Attention");
    assert.equal(get("drpp-setup-action").textContent, "Check Server");
    assert.doesNotMatch(get("drpp-setup-message").textContent, /private token|private song/);
  }
});

test("Settings notice hides for healthy servers and calls first poll checking", async () => {
  const status = createAppStatus({ config });
  let get = await notice(status.snapshot());
  assert.equal(get("drpp-setup").hidden, false);
  assert.equal(get("drpp-setup-title").textContent, "Checking Servers");
  assert.equal(get("drpp-setup-message").textContent, "Checking the media server connection...");
  const multi = createMultiServerProvider(config.servers.map((server) => ({ server, provider: { getPresence: async () => ({ state: "playing", title: "private song" }) } })));
  status.setServers(() => multi.servers());
  await status.wrapProvider(multi).getPresence();
  get = await notice(status.snapshot());
  assert.equal(get("drpp-setup").hidden, true);
});


test("an unavailable saved server also prevents the all-clear", async () => {
  const status = createAppStatus({ config });
  await status.wrapProvider({ getPresence: async () => ({ state: "playing", title: "private song" }) }).getPresence();
  status.setServers(() => [
    { provider: "plex", state: "playing", checkedAt: Date.now() },
    { provider: "jellyfin", state: "unavailable", reason: "CREDENTIAL_MISSING", checkedAt: null },
  ]);
  const get = await notice(status.snapshot());
  assert.equal(get("drpp-setup").hidden, false);
  assert.equal(get("drpp-setup-title").textContent, "Server Needs Attention");
});
