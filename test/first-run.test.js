import test from "node:test";
import assert from "node:assert/strict";
import { ensureConfigured, parseStartArgs, runBrowserSetup } from "../src/first-run.js";

test("an existing config starts straight away without opening setup", async () => {
  let opened = 0;
  assert.equal(await ensureConfigured({ configExists: async () => true, runSetup: async () => { opened += 1; return true; } }), "configured");
  assert.equal(opened, 0);
});

test("with no config, setup opens and start carries on once it writes one", async () => {
  let exists = false;
  const outcome = await ensureConfigured({ configExists: () => exists, runSetup: async () => { exists = true; return true; } });
  assert.equal(outcome, "setup-finished");
});

test("closing setup before Finish is reported as cancelled", async () => {
  assert.equal(await ensureConfigured({ configExists: () => false, runSetup: async () => true }), "setup-cancelled");
});

test("a setup window that can't be shown (or throws) is reported as unavailable", async () => {
  assert.equal(await ensureConfigured({ configExists: () => false, runSetup: async () => false }), "setup-unavailable");
  assert.equal(await ensureConfigured({ configExists: () => false, runSetup: async () => { throw new Error("no powershell"); } }), "setup-unavailable");
  await assert.rejects(ensureConfigured({}), /required/);
});

test("parses start arguments", () => {
  assert.deepEqual(parseStartArgs([]), { module: null, setup: true, tray: true });
  assert.deepEqual(parseStartArgs(["--no-setup"]), { module: null, setup: false, tray: true });
  assert.deepEqual(parseStartArgs(["--no-tray"]), { module: null, setup: true, tray: false });
  assert.deepEqual(parseStartArgs(["my.config.mjs"]), { module: "my.config.mjs", setup: true, tray: true });
  assert.throws(() => parseStartArgs(["--nope"]), /unknown start option: --nope/);
  assert.throws(() => parseStartArgs(["a.mjs", "b.mjs"]), /at most one/);
});

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

test("first launch opens the setup page in the browser once and waits for Finish", async () => {
  const opened = [];
  let checks = 0;
  const c = clock();
  const outcome = await ensureConfigured({
    configExists: () => checks > 3,
    runSetup: () => runBrowserSetup({ url: "http://127.0.0.1:5000/setup", openUrl: (url) => opened.push(url), configExists: () => ++checks > 3, ...c }),
  });
  assert.equal(outcome, "setup-finished");
  assert.deepEqual(opened, ["http://127.0.0.1:5000/setup"]);
});

test("a later launch with a config does not open the browser", async () => {
  let opened = 0;
  const outcome = await ensureConfigured({ configExists: () => true, runSetup: () => runBrowserSetup({ url: "http://127.0.0.1:5000/setup", openUrl: () => { opened += 1; }, configExists: () => true, ...clock() }) });
  assert.equal(outcome, "configured");
  assert.equal(opened, 0);
});

test("stops waiting after the timeout and reports setup as cancelled", async () => {
  const c = clock();
  const outcome = await ensureConfigured({ configExists: () => false, runSetup: () => runBrowserSetup({ url: "http://127.0.0.1:5000/setup", openUrl: () => {}, configExists: () => false, timeoutMs: 10_000, pollMs: 1000, ...c }) });
  assert.equal(outcome, "setup-cancelled");
  assert.equal(c.now(), 10_000);
});

test("a browser that can't be opened falls back to the other setup", async () => {
  let exists = false;
  const browser = () => runBrowserSetup({ url: "http://127.0.0.1:5000/setup", openUrl: () => { throw new Error("no browser"); }, configExists: () => exists, ...clock() });
  const outcome = await ensureConfigured({ configExists: () => exists, runSetup: () => browser().catch(async () => { exists = true; return true; }) });
  assert.equal(outcome, "setup-finished");
  await assert.rejects(runBrowserSetup({ url: "x" }), /required/);
});
