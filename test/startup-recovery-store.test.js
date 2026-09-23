import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStartupRecoveryStore, guardStartup, startupFailureSubsystem } from "../src/startup-recovery-store.js";

async function storeFile() { return join(await mkdtemp(join(tmpdir(), "np-recovery-")), "startup-recovery.json"); }
function manualTimers() {
  const pending = [];
  return { setTimer: (fn, ms) => { pending.push({ fn, ms }); return { unref() {} }; }, clearTimer: () => { pending.length = 0; }, fire: async () => { for (const { fn } of pending.splice(0)) await fn(); await new Promise((r) => setImmediate(r)); }, pending };
}

test("missing, corrupt or oversized state files load as a clean start", async () => {
  const file = await storeFile();
  const store = createStartupRecoveryStore({ file });
  assert.equal((await store.load()).failures, 0);
  await writeFile(file, "{not json");
  assert.equal((await store.load()).failures, 0);
  await writeFile(file, JSON.stringify({ failures: 2, pad: "x".repeat(5000) }));
  assert.equal((await store.load()).failures, 0);
});

test("a healthy start clears the count once it has stayed up", async () => {
  const file = await storeFile();
  const store = createStartupRecoveryStore({ file });
  await store.save({ failures: 2, subsystem: "provider" });
  const timers = manualTimers();
  const guarded = await guardStartup({ store, start: async ({ safeMode }) => ({ safeMode }), healthyAfterMs: 60_000, ...timers });
  assert.equal(guarded.safeMode, false);
  assert.equal((await store.load()).failures, 3, "counted as unconfirmed until healthy");
  assert.equal(timers.pending[0].ms, 60_000);
  await timers.fire();
  assert.equal((await store.load()).failures, 0);
});

test("three unconfirmed starts in a row start the next one in safe mode", async () => {
  const file = await storeFile();
  const store = createStartupRecoveryStore({ file });
  const seen = [];
  const start = async (options) => { seen.push(options.safeMode); return {}; };
  // Each run "crashes" before the healthy timer fires.
  for (let run = 0; run < 4; run += 1) await guardStartup({ store, start, ...manualTimers() });
  assert.deepEqual(seen, [false, false, false, true]);
  assert.equal((await store.load()).safeMode, true);
});

test("a start that throws records which subsystem failed and rethrows", async () => {
  const file = await storeFile();
  const store = createStartupRecoveryStore({ file });
  const error = Object.assign(new Error("bad config"), { startupCode: "CONFIG_INVALID" });
  await assert.rejects(guardStartup({ store, start: async () => { throw error; }, ...manualTimers() }), /bad config/);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1, failures: 1, subsystem: "configuration" });
});

test("an unwritable state file never blocks startup", async () => {
  const store = { load: async () => ({ failures: 0 }), save: async () => { throw new Error("EROFS"); } };
  const guarded = await guardStartup({ store, start: async () => ({ ok: true }), ...manualTimers() });
  assert.deepEqual(guarded.app, { ok: true });
});

test("maps startup codes to subsystems", () => {
  assert.equal(startupFailureSubsystem({ startupCode: "CONFIG_TOO_NEW" }), "configuration");
  assert.equal(startupFailureSubsystem({ startupCode: "CREDENTIAL_READ_FAILED" }), "provider");
  assert.equal(startupFailureSubsystem({ startupCode: "PORT_IN_USE" }), "unknown");
  assert.equal(startupFailureSubsystem(null), "unknown");
});

test("safe mode stays on until the user retries a normal start", async () => {
  const file = await storeFile();
  const store = createStartupRecoveryStore({ file });
  await store.save({ failures: 3, subsystem: "discord" });
  const timers = manualTimers();
  const guarded = await guardStartup({ store, start: async () => ({}), ...timers });
  assert.equal(guarded.safeMode, true);
  assert.equal(timers.pending.length, 0, "no automatic all-clear in safe mode");
  await guarded.retryNormal();
  assert.equal((await store.load()).failures, 0);
  const next = await guardStartup({ store, start: async () => ({}), ...manualTimers() });
  assert.equal(next.safeMode, false);
});
