import test from "node:test";
import assert from "node:assert/strict";
import { TRAY_EXIT, runTraySession } from "../src/tray-session.js";

function fakeApp(name, events) {
  return { name, url: `http://127.0.0.1:1/${name}`, close: async () => { events.push(`close ${name}`); } };
}

test("Quit closes the app", async () => {
  const events = [];
  const result = await runTraySession({ app: fakeApp("a", events), runTray: async () => TRAY_EXIT.quit, runSetup: async () => { throw new Error("no"); }, restartApp: async () => { throw new Error("no"); } });
  assert.deepEqual([result.outcome, events], ["quit", ["close a"]]);
});

test("Run setup again opens setup, restarts the app with the new settings, and shows the tray again", async () => {
  const events = [];
  const codes = [TRAY_EXIT.setup, TRAY_EXIT.quit];
  const trayApps = [];
  const result = await runTraySession({
    app: fakeApp("a", events),
    runTray: async (app) => { trayApps.push(app.name); return codes.shift(); },
    runSetup: async () => { events.push("setup"); return true; },
    restartApp: async () => { events.push("start b"); return fakeApp("b", events); },
    onRestart: (app) => events.push(`running ${app.name}`),
  });
  assert.equal(result.outcome, "quit");
  assert.deepEqual(events, ["setup", "close a", "start b", "running b", "close b"]);
  assert.deepEqual(trayApps, ["a", "b"]);
});

test("a setup window that fails to open still restarts on the saved settings", async () => {
  const events = [];
  const codes = [TRAY_EXIT.setup, TRAY_EXIT.quit];
  await runTraySession({ app: fakeApp("a", events), runTray: async () => codes.shift(), runSetup: async () => { throw new Error("no powershell"); }, restartApp: async () => fakeApp("b", events) });
  assert.deepEqual(events, ["close a", "close b"]);
});

test("a tray that can't start or crashes leaves the app running", async () => {
  const events = [];
  const app = fakeApp("a", events);
  const thrown = await runTraySession({ app, runTray: async () => { throw new Error("spawn failed"); }, runSetup: async () => true, restartApp: async () => app });
  assert.deepEqual([thrown.outcome, thrown.app, events], ["tray-failed", app, []]);
  const crashed = await runTraySession({ app, runTray: async () => 1, runSetup: async () => true, restartApp: async () => app });
  assert.deepEqual([crashed.outcome, crashed.app, events], ["tray-failed", app, []]);
});

test("a restart that fails is reported with its error", async () => {
  const events = [];
  const boom = new Error("CONFIG_INVALID");
  const result = await runTraySession({ app: fakeApp("a", events), runTray: async () => TRAY_EXIT.setup, runSetup: async () => true, restartApp: async () => { throw boom; } });
  assert.deepEqual([result.outcome, result.error, events], ["restart-failed", boom, ["close a"]]);
  await assert.rejects(runTraySession({}), /required/);
});
