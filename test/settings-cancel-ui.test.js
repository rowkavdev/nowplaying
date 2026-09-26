import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { SERVER_SCRIPT } from "../src/settings-onboarding-page.js";

const json = (body, ok = true) => ({ ok, json: async () => body });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function page() {
  const elements = new Map();
  const node = (id) => {
    if (!elements.has(id)) elements.set(id, {
      id, value: "", hidden: false, disabled: false, isConnected: true, textContent: "", children: [],
      addEventListener(event, fn) { this[event] = fn; },
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { this[name] = value; },
      focus() {},
    });
    return elements.get(id);
  };
  const fetches = [];
  runInNewContext(SERVER_SCRIPT, {
    document: { getElementById: node, createElement: (tag) => ({ tag, href: "", target: "", rel: "", textContent: "" }) },
    fetch: (path, options) => { const request = deferred(); fetches.push({ path, options, ...request }); return request.promise; },
    setTimeout, clearTimeout, URL, confirm: () => true, window: { open: () => null },
  });
  return { node, fetches };
}

test("cancelling manual sign-in restores focus to the Connect button", async () => {
  const { node, fetches } = page();
  fetches[0].resolve(json({ servers: [], firstRun: true })); await tick();
  node("server-url").value = "http://127.0.0.1:8096";
  node("server-provider").value = "navidrome";
  node("manual-connect").click({ currentTarget: node("manual-connect") });
  assert.equal(node("signin-panel").hidden, false);
  let focused = false;
  node("manual-connect").focus = () => { focused = true; };
  node("signin-cancel").click();
  assert.equal(node("signin-panel").hidden, true);
  assert.equal(focused, true, "focus must not remain on a hidden cancel button");
});

test("failed cancel keeps a completed discovery result and never claims cancellation", async () => {
  const { node, fetches } = page();
  fetches[0].resolve(json({ servers: [], firstRun: true })); await tick();
  const discovery = node("discover-servers").click();
  assert.equal(fetches[1].path, "/api/settings/servers/discover");
  const cancellation = node("cancel-discovery").click();
  assert.equal(node("discovery-state").textContent, "Cancelling scan...");
  fetches[2].resolve(json({ error: "failed" }, false)); await cancellation;
  assert.equal(node("discovery-state").textContent, "Could not cancel the scan. Waiting for results...");
  fetches[1].resolve(json({ servers: [] })); await discovery;
  assert.equal(node("discovery-state").textContent, "No servers found. Add one by address below.");
});

test("confirmed cancellation reports it only when discovery replies cancelled", async () => {
  const { node, fetches } = page();
  fetches[0].resolve(json({ servers: [], firstRun: true })); await tick();
  const discovery = node("discover-servers").click();
  const cancellation = node("cancel-discovery").click();
  fetches[2].resolve(json({ cancelled: true })); await cancellation;
  fetches[1].resolve(json({ cancelled: true })); await discovery;
  assert.equal(node("discovery-state").textContent, "Scan cancelled. Not all addresses were checked.");
  assert.deepEqual(node("discovered-list").children, []);
});

test("a late cancel response cannot overwrite completed discovery", async () => {
  const { node, fetches } = page();
  fetches[0].resolve(json({ servers: [], firstRun: true })); await tick();
  const discovery = node("discover-servers").click();
  const cancellation = node("cancel-discovery").click();
  fetches[1].resolve(json({ servers: [] })); await discovery;
  fetches[2].resolve(json({ cancelled: false })); await cancellation;
  assert.equal(node("discovery-state").textContent, "No servers found. Add one by address below.");
});

test("blocked Plex popup leaves a clickable same-origin sign-in link", async () => {
  const { node, fetches } = page();
  fetches[0].resolve(json({ servers: [], firstRun: true })); await tick();
  node("server-url").value = "http://127.0.0.1:32400";
  node("server-provider").value = "plex";
  node("manual-connect").click({ currentTarget: node("manual-connect") });
  const start = node("signin-button").click();
  assert.equal(fetches[1].path, "/api/setup/signin");
  const url = "https://app.plex.tv/auth#?code=example";
  fetches[1].resolve(json({ status: "pending", flowId: "flow-1", authUrl: url }));
  await tick();
  assert.equal(node("signin-open-link").hidden, false);
  assert.equal(node("signin-open-link").children[0].href, url);
  assert.equal(node("signin-open-link").children[0].target, "_blank");
  assert.equal(node("signin-open-link").children[0].rel, "noopener noreferrer");
  node("signin-cancel").click();
  fetches[2].resolve(json({ status: "cancelled" }));
  await start;
  assert.equal(node("signin-open-link").hidden, true);
});
