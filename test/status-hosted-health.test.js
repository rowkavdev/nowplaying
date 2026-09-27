import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { createAppStatus } from "../src/app-status.js";
import { createStatusPageHandler } from "../src/status-page-handler.js";

const config = { provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Private User" } };

async function view(status) {
  const handle = createStatusPageHandler({ status, fallback: async () => null });
  const page = (await handle({ url: "/status" })).body;
  assert.match(page, /id="hosted-state"/);
  const snapshot = JSON.parse((await handle({ url: "/api/status" })).body);
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, { textContent: "", className: "", hidden: false, src: "", addEventListener() {}, replaceChildren() {} });
    return nodes.get(id);
  };
  runInNewContext((await handle({ url: "/status.js" })).body, {
    document: { getElementById: get, createElement: () => ({ textContent: "" }) },
    fetch: async () => ({ ok: true, json: async () => snapshot }),
    Date, setInterval() {}, navigator: { clipboard: { writeText: async () => {} } },
  });
  for (let i = 0; i < 10 && get("summary").textContent === ""; i++) await new Promise((resolve) => setImmediate(resolve));
  return { snapshot, get, tray: status.tray(), report: JSON.parse((await handle({ url: "/api/diagnostics" })).body) };
}

test("hosted network failure is visible on status page, tray and diagnostics", async () => {
  const status = createAppStatus({ config });
  await status.wrapProvider({ getPresence: async () => ({ state: "idle" }) }).getPresence();
  status.setHosted(() => ({ enabled: true, state: "retrying", lastError: "network_error", token: "secret", cardUrl: "https://private.invalid" }));
  const { snapshot, get, tray, report } = await view(status);
  assert.equal(snapshot.hosted.error, "network_error");
  assert.equal(get("summary").textContent, "Something needs attention - see below.");
  assert.match(get("hosted-state").textContent, /Upload failed - retrying/);
  assert.equal(tray.status, "degraded");
  assert.equal(tray.action, "open_troubleshooting");
  assert.match(tray.text, /hosted card needs attention/);
  assert.equal(report.health, "degraded");
  assert.deepEqual(report.enabledOutputs, ["card", "hosted"]);
  assert.deepEqual(report.errors, ["hosted_network_error"]);
  assert.doesNotMatch(JSON.stringify({ tray, report }), /Private User|private.invalid|secret|127.0.0.1/);
});

test("off and connected hosting keep all-clear; startup does not look like failure", async () => {
  const status = createAppStatus({ config });
  await status.wrapProvider({ getPresence: async () => ({ state: "idle" }) }).getPresence();
  for (const [state, expected] of [["off", "healthy"], ["idle", "starting"], ["connected", "healthy"]]) {
    status.setHosted(() => ({ enabled: state !== "off", state }));
    const { get, tray, report } = await view(status);
    assert.equal(tray.status, expected);
    assert.equal(report.health, expected);
    assert.deepEqual(report.errors, []);
    assert.equal(get("summary").textContent, expected === "healthy" ? "Everything is working." : "Starting up...");
  }
});

test("unknown hosted errors are never copied into diagnostics", async () => {
  const status = createAppStatus({ config });
  await status.wrapProvider({ getPresence: async () => ({ state: "idle" }) }).getPresence();
  status.setHosted(() => ({ enabled: true, state: "retrying", lastError: "token=private" }));
  const { report, snapshot } = await view(status);
  assert.equal(snapshot.hosted.error, null);
  assert.deepEqual(report.errors, ["hosted_upload_failed"]);
  assert.doesNotMatch(JSON.stringify(report), /private/);
});


test("provider authentication failure outranks hosted startup on every surface", async () => {
  const status = createAppStatus({ config });
  const provider = status.wrapProvider({ getPresence: async () => { throw Object.assign(new Error("private token"), { status: 401 }); } });
  await assert.rejects(provider.getPresence());
  for (const state of ["idle", "starting"]) {
    status.setHosted(() => ({ enabled: true, state }));
    const { get, tray, report } = await view(status);
    assert.equal(tray.status, "degraded");
    assert.equal(tray.action, "test_provider_connection");
    assert.match(tray.text, /sign-in rejected/);
    assert.equal(get("summary").textContent, "Something needs attention - see below.");
    assert.equal(report.health, "degraded");
  }
});
