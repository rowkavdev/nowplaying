import test from "node:test";
import assert from "node:assert/strict";
import { confirmHealthyStartup, createStartupRecoveryState, recordStartupFailure, startupFailureThreshold, startupRecoveryActions } from "../src/startup-recovery.js";

test("starts in normal mode with all runtime capabilities enabled", () => {
  assert.equal(startupFailureThreshold, 3);
  assert.deepEqual(createStartupRecoveryState(), {
    version: 1,
    failures: 0,
    subsystem: null,
    safeMode: false,
    capabilities: { polling: true, discord: true, updates: true, settings: true, diagnostics: true, retry: true },
  });
});

test("enters safe mode at the third consecutive pre-healthy failure", () => {
  let state = createStartupRecoveryState();
  state = recordStartupFailure(state, "configuration");
  assert.equal(state.safeMode, false);
  state = recordStartupFailure(state, "provider");
  assert.equal(state.safeMode, false);
  state = recordStartupFailure(state, "discord");
  assert.equal(state.failures, 3);
  assert.equal(state.subsystem, "discord");
  assert.equal(state.safeMode, true);
});

test("safe mode isolates network polling, Discord and updates", () => {
  const state = createStartupRecoveryState({ failures: 3, subsystem: "updater" });
  assert.deepEqual(state.capabilities, { polling: false, discord: false, updates: false, settings: true, diagnostics: true, retry: true });
  assert.deepEqual(startupRecoveryActions(state), ["open_settings", "export_diagnostics", "retry_normal_startup"]);
  assert.equal(Object.isFrozen(state.capabilities), true);
  assert.equal(Object.isFrozen(startupRecoveryActions(state)), true);
});

test("normal mode exposes no recovery-only actions", () => {
  assert.deepEqual(startupRecoveryActions(createStartupRecoveryState({ failures: 2, subsystem: "provider" })), []);
});

test("clears the counter only after an explicit healthy confirmation", () => {
  const failed = createStartupRecoveryState({ failures: 4, subsystem: "provider" });
  assert.deepEqual(confirmHealthyStartup(failed, false), failed);
  assert.deepEqual(confirmHealthyStartup(failed), failed);
  assert.deepEqual(confirmHealthyStartup(failed, true), createStartupRecoveryState());
});

test("tracks only bounded subsystem labels without error text", () => {
  for (const subsystem of ["configuration", "provider", "discord", "updater", "unknown"]) {
    const state = recordStartupFailure({}, subsystem);
    assert.equal(state.subsystem, subsystem);
  }
  assert.throws(() => recordStartupFailure({}, "token=secret https://private.invalid"), /subsystem is invalid/);
  const state = createStartupRecoveryState({ failures: 3, subsystem: "token=secret", error: "https://private.invalid" });
  assert.equal(state.subsystem, null);
  const serialized = JSON.stringify(state);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("private"), false);
});

test("normalizes malformed persisted counters to a safe baseline", () => {
  for (const failures of [-1, 1.5, "3", null, Number.NaN]) {
    const state = createStartupRecoveryState({ failures, subsystem: "provider" });
    assert.equal(state.failures, 0);
    assert.equal(state.safeMode, false);
  }
});
