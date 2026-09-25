import test from "node:test";
import assert from "node:assert/strict";
import { TRAY_EXIT, createRestartRequests, runTraySession } from "../src/tray-session.js";

function fakeApp(name, events) {
  return { name, url: `http://127.0.0.1:1/${name}`, close: async () => { events.push(`close ${name}`); } };
}

test("Quit closes the app", async () => {
  const events = [];
  const result = await runTraySession({ app: fakeApp("a", events), runTray: async () => TRAY_EXIT.quit, restartApp: async () => { throw new Error("no"); } });
  assert.deepEqual([result.outcome, events], ["quit", ["close a"]]);
});

test("a tray that fails leaves the app running", async () => {
  const events = [];
  const app = fakeApp("a", events);
  const result = await runTraySession({ app, runTray: async () => { throw new Error("spawn failed"); }, restartApp: async () => app });
  assert.deepEqual([result.outcome, result.app, events], ["tray-failed", app, []]);
});

test("WebUI configuration request restarts once, without opening a wizard", async () => {
  const events = [];
  const requests = createRestartRequests();
  let quit;
  const trayStarts = [];
  const session = runTraySession({
    app: fakeApp("a", events),
    runTray: (app) => { trayStarts.push(app.name); return new Promise((resolve) => { quit = () => resolve(TRAY_EXIT.quit); }); },
    restartApp: async () => { events.push("start b"); requests.request(); return fakeApp("b", events); },
    onRestart: (app) => events.push(`running ${app.name}`),
    restartRequests: requests,
  });
  await new Promise((resolve) => setImmediate(resolve));
  requests.request();
  for (let i = 0; i < 20 && !events.includes("running b"); i++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["close a", "start b", "running b"]);
  assert.deepEqual(trayStarts, ["a"]);
  quit();
  const result = await session;
  assert.equal(result.outcome, "quit");
  assert.deepEqual(events.slice(-1), ["close b"]);
});

test("a WebUI restart failure is reported", async () => {
  const requests = createRestartRequests();
  requests.request();
  const result = await runTraySession({ app: fakeApp("a", []), runTray: () => new Promise(() => {}), restartApp: async () => { throw new Error("port busy"); }, restartRequests: requests });
  assert.equal(result.outcome, "restart-failed");
  assert.equal(result.error.message, "port busy");
  await assert.rejects(runTraySession({}), /required/);
});
