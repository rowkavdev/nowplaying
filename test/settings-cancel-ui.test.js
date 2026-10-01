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
  const fetches = []; const pollTimers = [];
  const document = { activeElement: null, getElementById: node, createElement: (tag) => ({ tag, href: "", target: "", rel: "", textContent: "", children: [], append(...children) { this.children.push(...children); }, addEventListener() {} }) };
  runInNewContext(SERVER_SCRIPT, {
    document,
    fetch: (path, options) => { const request = deferred(); fetches.push({ path, options, ...request }); return request.promise; },
    setTimeout: (fn, delay) => { if (delay === 2000) { pollTimers.push(fn); return pollTimers.length; } const timer = setTimeout(fn, delay); timer.unref(); return timer; }, clearTimeout, URL, confirm: () => true, window: { open: () => null },
  });
  return { node, fetches, pollTimers, document };
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

test("commit-phase 409 keeps sign-in visible until the original poll succeeds", async () => {
  const { node, fetches, pollTimers } = page();
  fetches[0].resolve(json({ servers: [], firstRun: false })); await tick();
  node("server-url").value = "http://127.0.0.1:32400";
  node("server-provider").value = "plex";
  node("manual-connect").click({ currentTarget: node("manual-connect") });
  const start = node("signin-button").click();
  fetches[1].resolve(json({ status: "pending", flowId: "flow-1", authUrl: "https://app.plex.tv/auth" })); await start;
  const poll = pollTimers.shift()();
  assert.equal(fetches[2].path, "/api/setup/signin");
  const cancel = node("signin-cancel").click();
  assert.equal(fetches[3].path, "/api/setup/signin");
  assert.equal(node("signin-panel").hidden, false);
  fetches[3].resolve(json({ error: "signin_in_progress" }, false)); await cancel;
  assert.equal(node("signin-panel").hidden, false);
  assert.match(node("signin-result").textContent, /finishing|still in progress/i);
  fetches[2].resolve(json({ status: "signed_in", identity: { displayName: "Me" } })); await tick();
  fetches[4].resolve(json({ servers: [{ provider: "plex", name: "Me", baseUrl: "http://127.0.0.1:32400" }] }));
  await poll;
  assert.equal(node("signin-panel").hidden, true);
  assert.match(node("servers-list").children[0].children[0].textContent, /Plex - Me/);
});

test("switching servers during a credential commit cannot hide the original sign-in", async () => {
  const { node, fetches, pollTimers } = page();
  fetches[0].resolve(json({ servers: [], firstRun: false })); await tick();
  node("server-url").value = "http://127.0.0.1:32400";
  node("server-provider").value = "plex";
  node("manual-connect").click({ currentTarget: node("manual-connect") });
  const start = node("signin-button").click();
  fetches[1].resolve(json({ status: "pending", flowId: "flow-1", authUrl: "https://app.plex.tv/auth" })); await start;
  const poll = pollTimers.shift()();
  node("server-url").value = "http://127.0.0.1:8096";
  node("server-provider").value = "jellyfin";
  const switchServer = node("manual-connect").click({ currentTarget: node("manual-connect") });
  assert.equal(fetches[3].path, "/api/setup/signin");
  fetches[3].resolve(json({ error: "signin_in_progress" }, false)); await tick();
  assert.equal(node("signin-title").textContent, "Connect to Plex");
  assert.match(node("signin-result").textContent, /finishing|still in progress/i);
  fetches[2].resolve(json({ status: "signed_in", identity: { displayName: "Me" } })); await tick();
  fetches[4].resolve(json({ servers: [{ provider: "plex", name: "Me", baseUrl: "http://127.0.0.1:32400" }] })); await poll;
  assert.match(node("servers-list").children[0].children[0].textContent, /Plex - Me/);
});

test("switching servers waits for successful pre-commit cancellation", async () => {
  const { node, fetches } = page();
  fetches[0].resolve(json({ servers: [], firstRun: false })); await tick();
  node("server-url").value = "http://127.0.0.1:32400";
  node("server-provider").value = "plex";
  node("manual-connect").click({ currentTarget: node("manual-connect") });
  const start = node("signin-button").click();
  fetches[1].resolve(json({ status: "pending", flowId: "flow-1", authUrl: "https://app.plex.tv/auth" })); await start;
  node("server-url").value = "http://127.0.0.1:8096";
  node("server-provider").value = "jellyfin";
  const switchServer = node("manual-connect").click({ currentTarget: node("manual-connect") });
  assert.equal(node("signin-title").textContent, "Connect to Plex");
  fetches[2].resolve(json({ status: "cancelled" })); await tick();
  assert.equal(node("signin-title").textContent, "Connect to Jellyfin");
});

test("successful pre-commit cancel hides sign-in only after server acknowledgement", async () => {
  const { node, fetches } = page();
  fetches[0].resolve(json({ servers: [], firstRun: false })); await tick();
  node("server-url").value = "http://127.0.0.1:32400";
  node("server-provider").value = "plex";
  node("manual-connect").click({ currentTarget: node("manual-connect") });
  const start = node("signin-button").click();
  fetches[1].resolve(json({ status: "pending", flowId: "flow-1", authUrl: "https://app.plex.tv/auth" })); await start;
  const cancel = node("signin-cancel").click();
  assert.equal(node("signin-panel").hidden, false);
  fetches[2].resolve(json({ status: "cancelled" })); await cancel;
  assert.equal(node("signin-panel").hidden, true);
});

test("Cancel before provider start returns cannot open a late sign-in", async () => {
  const { node, fetches, pollTimers } = page();
  fetches[0].resolve(json({ servers: [], firstRun: false })); await tick();
  node("server-url").value = "http://127.0.0.1:32400";
  node("server-provider").value = "plex";
  node("manual-connect").click({ currentTarget: node("manual-connect") });
  const start = node("signin-button").click();
  assert.equal(fetches[1].path, "/api/setup/signin");
  const cancel = node("signin-cancel").click(); await cancel;
  assert.equal(node("signin-panel").hidden, true);
  fetches[1].resolve(json({ status: "pending", flowId: "late-flow", authUrl: "https://app.plex.tv/auth" }));
  await start;
  assert.equal(node("signin-panel").hidden, true);
  assert.equal(node("signin-open-link").hidden, true);
  assert.equal(pollTimers.length, 0);
  assert.equal(fetches[2].path, "/api/setup/signin");
  assert.match(fetches[2].options.body, /"action":"cancel"/);
  fetches[2].resolve(json({ status: "cancelled" }));
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

test("quick scan shows a safe, copyable reason for a missing localhost Plex", async () => {
  const { node, fetches } = page();
  fetches[0].resolve(json({ servers: [], firstRun: true })); await tick();
  const scan = node("discover-servers").click();
  fetches[1].resolve(json({ servers: [], probeFailures: [{ provider: "plex", baseUrl: "http://127.0.0.1:32400", reason: "timeout" }] }));
  await scan;
  assert.match(node("discovery-state").textContent, /Plex at 127\.0\.0\.1:32400\/identity timed out/);
  assert.doesNotMatch(node("discovery-state").textContent, /password|token|Secret Track/);
});

test("quick scan distinguishes failed local discovery from a real empty scan", async () => {
  const { node, fetches } = page();
  fetches[0].resolve(json({ servers: [], firstRun: true })); await tick();
  const scan = node("discover-servers").click();
  fetches[1].resolve(json({ servers: [], probeFailures: [{ provider: "local_discovery", baseUrl: "http://127.0.0.1", reason: "discovery_failed" }] }));
  await scan;
  assert.match(node("discovery-state").textContent, /Local discovery failed before it could check Plex/);
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
  const cancel = node("signin-cancel").click();
  fetches[2].resolve(json({ status: "cancelled" }));
  await cancel; await start;
  assert.equal(node("signin-open-link").hidden, true);
});

test("first-run page shows a recovery path when restart rejects", async () => {
  const { node, fetches } = page();
  fetches[0].resolve(json({ configured: true, activationFailed: true, servers: [] })); await tick();
  assert.match(node("first-run-state").textContent, /couldn't start/);
  assert.equal(node("activation-recovery").hidden, false);
});

test("a new successful sign-in retries first-run activation after a failed restart", async () => {
  const { node, fetches } = page();
  fetches[0].resolve(json({ configured: true, activationFailed: true, servers: [] })); await tick();
  assert.match(node("first-run-state").textContent, /couldn't start/);
  node("server-url").value = "http://127.0.0.1:4533";
  node("server-provider").value = "navidrome";
  node("manual-connect").click({ currentTarget: node("manual-connect") });
  const signIn = node("signin-button").click();
  fetches[1].resolve(json({ status: "signed_in", identity: { displayName: "Me" } }));
  await tick();
  assert.equal(fetches[2].path, "/api/settings/servers");
  fetches[2].resolve(json({ configured: true, activationFailed: false, servers: [] }));
  await signIn;
  assert.match(node("first-run-state").textContent, /Starting NowPlaying/);
  assert.equal(node("activation-recovery").hidden, true);
});

test("first-run page stops polling with recovery after a startup deadline", async () => {
  const elements = new Map(); const timers = []; let now = 0; const requests = [];
  const node = (id) => {
    if (!elements.has(id)) elements.set(id, { id, hidden: id === "activation-recovery", textContent: "", value: "", children: [],
      addEventListener() {}, replaceChildren(...children) { this.children = children; } });
    return elements.get(id);
  };
  runInNewContext(SERVER_SCRIPT, {
    document: { getElementById: node, createElement: () => ({ append() {}, addEventListener() {} }) },
    fetch: (path) => { requests.push(path); return Promise.resolve(json(path === "/api/settings/servers" ? { configured: true, servers: [] } : {}, path === "/api/settings/servers")); },
    setTimeout: (fn) => { timers.push(fn); }, clearTimeout() {}, Date: { now: () => now }, performance: { now: () => now }, URL, window: {},
  });
  await tick();
  assert.equal(timers.length, 2);
  now = 30001;
  timers.shift()(); await tick();
  assert.match(node("first-run-state").textContent, /couldn't start/);
  assert.equal(node("activation-recovery").hidden, false);
  timers.shift()(); await tick();
  assert.deepEqual(requests, ["/api/settings/servers"]);
});

test("first-run activation deadline is not extended by a backward wall-clock change", async () => {
  const elements = new Map(); const timers = []; const requests = [];
  let wall = 1_800_000_000_000, elapsed = 0;
  const node = (id) => {
    if (!elements.has(id)) elements.set(id, { id, hidden: id === "activation-recovery", textContent: "", value: "", children: [],
      addEventListener() {}, replaceChildren(...children) { this.children = children; } });
    return elements.get(id);
  };
  runInNewContext(SERVER_SCRIPT, {
    document: { getElementById: node, createElement: () => ({ append() {}, addEventListener() {} }) },
    fetch: (path) => { requests.push(path); return Promise.resolve(json(path === "/api/settings/servers" ? { configured: true, servers: [] } : {}, path === "/api/settings/servers")); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); }, clearTimeout() {}, Date: { now: () => wall }, performance: { now: () => elapsed }, URL, window: {},
  });
  await tick();
  assert.equal(timers.length, 2);
  wall -= 3_600_000;
  elapsed = 30_001;
  // Simulate a throttled activation timeout while the shorter status poll fires.
  assert.deepEqual(timers.map(({ ms }) => ms), [30_000, 1_200]);
  timers.find(({ ms }) => ms === 1_200).fn(); await tick();
  assert.match(node("first-run-state").textContent, /couldn't start/);
  assert.equal(node("activation-recovery").hidden, false);
  assert.deepEqual(requests, ["/api/settings/servers", "/api/status", "/api/settings/servers"]);
});

test("capacity and config-save errors are explained in the Settings sign-in panel", async () => {
  for (const [code, message] of [
    ["too_many_servers", "You can add up to 8 servers."],
    ["draft_update_failed", "Could not save the server. Try again."],
  ]) {
    const { node, fetches } = page();
    fetches[0].resolve(json({ servers: [], firstRun: true })); await tick();
    node("server-url").value = "http://127.0.0.1:4533";
    node("server-provider").value = "navidrome";
    node("manual-connect").click({ currentTarget: node("manual-connect") });
    const signIn = node("signin-button").click();
    assert.equal(fetches[1].path, "/api/setup/signin");
    fetches[1].resolve(json({ error: code }, false));
    await signIn;
    assert.equal(node("signin-result").textContent, `Sign-in failed: ${message}`);
  }});

test("successful manual sign-in announces completion outside the hidden panel and restores focus", async () => {
  const {node,fetches}=page();
  fetches[0].resolve(json({servers:[]}));await tick();
  node("server-url").value="http://127.0.0.1:8096";node("server-provider").value="emby";
  node("manual-connect").click({currentTarget:node("manual-connect")});
  let focused=false;node("manual-connect").focus=()=>{focused=true;};
  const start=node("signin-button").click();
  fetches[1].resolve(json({status:"signed_in",identity:{displayName:"Fixture"}}));await tick();
  fetches[2].resolve(json({servers:[{provider:"emby",name:"Fixture",baseUrl:"http://127.0.0.1:8096"}]}));await start;
  assert.equal(node("signin-panel").hidden,true);
  assert.equal(focused,true,"completed sign-in must not leave focus in the hidden panel");
  assert.match(node("discovery-state").textContent,/Connected as Fixture/);
});

test("a failed server refresh after sign-in keeps its warning next to the success message", async () => {
  const {node,fetches}=page();
  fetches[0].resolve(json({servers:[]}));await tick();
  node("server-url").value="http://127.0.0.1:8096";node("server-provider").value="emby";
  node("manual-connect").click({currentTarget:node("manual-connect")});
  const start=node("signin-button").click();
  fetches[1].resolve(json({status:"signed_in",identity:{displayName:"Fixture"}}));await tick();
  fetches[2].resolve(json({error:"server_error"},false));await start;
  assert.match(node("discovery-state").textContent,/Connected as Fixture/);
  assert.match(node("discovery-state").textContent,/Could not load servers\. Reload this page\./);
});


test("scan completion restores keyboard focus before hiding Cancel scan", async () => {
 const {node,fetches,document}=page();
 fetches[0].resolve(json({servers:[]}));await tick();
 const scan=node("discover-servers").click();
 document.activeElement=node("cancel-discovery");let focused=false;
 node("discover-servers").focus=()=>{focused=true;};
 fetches[1].resolve(json({servers:[],cancelled:true}));await scan;
 assert.equal(node("cancel-discovery").hidden,true);
 assert.equal(focused,true,"hidden scan control must not retain keyboard focus");
});
