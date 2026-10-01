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

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve)); };

function quitDuringRestartFixture() {
  const events = [];
  const restarts = createRestartRequests();
  const quits = createRestartRequests();
  const gates = { close: null, restart: null };
  const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
  const app = (name, gate) => ({ name, close: async () => { events.push(`close ${name}`); if (gate) await gate.promise; } });
  return { events, restarts, quits, gates, deferred, app };
}

for (const stage of ["restart", "close", "after-restart"]) {
  test(`one outside quit during a Settings restart (${stage}) closes the replacement app and stops the tray`, async () => {
    const f = quitDuringRestartFixture();
    f.gates.close = f.deferred(); f.gates.restart = f.deferred();
    const first = f.app("a", stage === "close" ? f.gates.close : null);
    const second = f.app("b", null);
    const session = runTraySession({
      app: first,
      runTray: () => new Promise(() => {}),
      restartApp: async () => { f.events.push("restart entered"); if (stage !== "close") await f.gates.restart.promise; return second; },
      onRestart: (current) => f.events.push(`running ${current.name}`),
      restartRequests: f.restarts,
      quitRequests: f.quits,
      stopTray: async () => { f.events.push("stop tray"); },
    });
    await settle();
    f.restarts.request();
    await settle();
    if (stage !== "after-restart") { f.quits.request(); await settle(); }
    if (stage === "close") f.gates.close.resolve(); else f.gates.restart.resolve();
    if (stage === "after-restart") { await settle(); f.quits.request(); }
    const result = await Promise.race([session, new Promise((resolve) => setTimeout(() => resolve({ outcome: "still running", events: f.events }), 500))]);
    assert.equal(result.outcome, "quit", JSON.stringify(f.events));
    assert.ok(f.events.includes("close b"), JSON.stringify(f.events));
    assert.ok(f.events.includes("stop tray"), JSON.stringify(f.events));
  });
}

test("a second Settings restart after a handled restart still works and a later quit is honoured once", async () => {
  const f = quitDuringRestartFixture();
  const apps = [f.app("b"), f.app("c")];
  const session = runTraySession({
    app: f.app("a"), runTray: () => new Promise(() => {}),
    restartApp: async () => apps.shift(), onRestart: (current) => f.events.push(`running ${current.name}`),
    restartRequests: f.restarts, quitRequests: f.quits, stopTray: async () => { f.events.push("stop tray"); },
  });
  await settle(); f.restarts.request(); await settle(); f.restarts.request(); await settle(); f.quits.request();
  assert.equal((await session).outcome, "quit");
  assert.deepEqual(f.events, ["close a", "running b", "close b", "running c", "close c", "stop tray"]);
});

test("a stop request after a tray failure still closes the app once (#880)", async () => {
  const { watchQuitAfterTrayFailure } = await import("../src/tray-session.js");
  const quits = createRestartRequests();
  const session = await runTraySession({
    app: fakeApp("a", []), runTray: async () => { throw new Error("spawn failed"); },
    restartApp: async () => { throw new Error("no"); }, quitRequests: quits,
  });
  assert.equal(session.outcome, "tray-failed");
  let closed = 0;
  assert.equal(watchQuitAfterTrayFailure(session, quits, async () => { closed += 1; }), true);
  quits.request();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, 1);
  assert.equal(watchQuitAfterTrayFailure({ outcome: "quit" }, quits, async () => { closed += 1; }), false);
});
