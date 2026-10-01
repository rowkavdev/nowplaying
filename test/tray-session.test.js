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

test("an outside quit request closes the app and ends the tray (#780)", async () => {
  const events = [];
  const quitRequests = createRestartRequests();
  let trayStopped = 0;
  const session = runTraySession({
    app: fakeApp("a", events),
    runTray: () => new Promise(() => {}),
    restartApp: async () => { throw new Error("no"); },
    quitRequests,
    stopTray: async () => { trayStopped += 1; },
  });
  quitRequests.request();
  const result = await session;
  assert.equal(result.outcome, "quit");
  assert.deepEqual(events, ["close a"]);
  assert.equal(trayStopped, 1);
});

test("an outside quit without a stopTray hook still closes the app", async () => {
  const events = [];
  const quitRequests = createRestartRequests();
  const session = runTraySession({
    app: fakeApp("a", events),
    runTray: () => new Promise(() => {}),
    restartApp: async () => { throw new Error("no"); },
    quitRequests,
  });
  quitRequests.request();
  const result = await session;
  assert.equal(result.outcome, "quit");
  assert.deepEqual(events, ["close a"]);
});

test("every real tray session outcome is written to the app log with a privacy-safe status and code", async () => {
  const { createAppLogger } = await import("../src/app-log.js");
  const { trayLogEvent } = await import("../src/tray-session.js");
  const noEvents = [];
  const startupError = Object.assign(new Error("failed at C:\\Users\\rowan\\secret"), { startupCode: "CONFIG_INVALID" });
  const requests = () => { const r = createRestartRequests(); r.request(); return r; };
  const sessions = [
    await runTraySession({ app: fakeApp("a", noEvents), runTray: async () => TRAY_EXIT.quit, restartApp: async () => { throw new Error("no"); } }),
    await runTraySession({ app: fakeApp("a", noEvents), runTray: async () => { throw new Error("spawn failed"); }, restartApp: async () => { throw new Error("no"); } }),
    await runTraySession({ app: fakeApp("a", noEvents), runTray: () => new Promise(() => {}), restartApp: async () => { throw startupError; }, restartRequests: requests() }),
    await runTraySession({ app: fakeApp("a", noEvents), runTray: () => new Promise(() => {}), restartApp: async () => { throw new Error("odd"); }, restartRequests: requests() }),
  ];
  assert.deepEqual(sessions.map((s) => s.outcome), ["quit", "tray-failed", "restart-failed", "restart-failed"]);
  const { serializeLogEvent } = await import("../src/app-log.js");
  const written = [];
  const logger = createAppLogger({ env: { LOCALAPPDATA: "C:\\L" }, platform: "win32", createLog: () => ({ write: async (event) => { written.push(serializeLogEvent(event)); } }) });
  for (const session of sessions) {
    const mapped = trayLogEvent(session);
    assert.equal(await logger.event("tray", mapped.status, mapped.options), true);
  }
  assert.equal(logger.failures(), 0);
  const lines = written.map((line) => JSON.parse(line));
  assert.deepEqual(lines.map(({ level, component, status, code }) => ({ level, component, status, code })), [
    { level: "info", component: "tray", status: "stopped", code: undefined },
    { level: "error", component: "tray", status: "failed", code: "TRAY_FAILED" },
    { level: "error", component: "tray", status: "failed", code: "CONFIG_INVALID" },
    { level: "error", component: "tray", status: "failed", code: "START_FAILED" },
  ]);
  assert.doesNotMatch(JSON.stringify(lines), /rowan|secret|odd|spawn/);
});
