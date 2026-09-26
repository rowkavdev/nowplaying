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
      id, value: "", hidden: false, disabled: false, textContent: "", children: [],
      addEventListener(event, fn) { this[event] = fn; },
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      focus() {},
    });
    return elements.get(id);
  };
  const fetches = [];
  runInNewContext(SERVER_SCRIPT, {
    document: { getElementById: node, createElement: () => node(`created-${Math.random()}`) },
    fetch: (path, options) => { const request = deferred(); fetches.push({ path, options, ...request }); return request.promise; },
    setTimeout, clearTimeout, URL, confirm: () => true,
  });
  return { node, fetches };
}

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
