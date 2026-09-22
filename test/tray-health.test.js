import test from "node:test";
import assert from "node:assert/strict";
import { createTrayHealth } from "../src/tray-health.js";

const NOW = Date.parse("2026-09-23T00:40:00.000Z");
const HEALTHY = { provider: "connected", card: "healthy", discord: "healthy", lastSuccessfulPollAt: NOW - 30_000, now: NOW };

test("distinguishes starting, healthy and stopped", () => {
  assert.equal(createTrayHealth({ now: NOW }).status, "starting");
  assert.equal(createTrayHealth(HEALTHY).status, "healthy");
  assert.equal(createTrayHealth({ ...HEALTHY, running: false }).status, "stopped");
  assert.equal(createTrayHealth({ ...HEALTHY, provider: "stopped" }).status, "stopped");
});

test("degrades for each provider failure and links to connection testing", () => {
  for (const provider of ["unreachable", "authentication_failed", "invalid_configuration"]) {
    const result = createTrayHealth({ ...HEALTHY, provider });
    assert.equal(result.status, "degraded", provider);
    assert.equal(result.action, "test_provider_connection", provider);
  }
});

test("degrades for each failed output and links to troubleshooting", () => {
  for (const output of ["card", "discord"]) {
    const result = createTrayHealth({ ...HEALTHY, [output]: "failed" });
    assert.equal(result.status, "degraded", output);
    assert.equal(result.action, "open_troubleshooting", output);
  }
  assert.equal(createTrayHealth({ ...HEALTHY, card: "disabled", discord: "disabled" }).status, "healthy");
});

test("uses a deterministic stale boundary and clamps future timestamps", () => {
  const fresh = createTrayHealth({ ...HEALTHY, lastSuccessfulPollAt: NOW - 120_000 });
  assert.equal(fresh.stale, false);
  assert.equal(fresh.status, "healthy");
  const stale = createTrayHealth({ ...HEALTHY, lastSuccessfulPollAt: NOW - 120_001 });
  assert.equal(stale.stale, true);
  assert.equal(stale.status, "degraded");
  assert.equal(stale.action, "open_troubleshooting");
  assert.equal(createTrayHealth({ ...HEALTHY, lastSuccessfulPollAt: NOW + 5_000 }).lastSuccessfulPollAgeMs, 0);
});

test("accepts Date poll timestamps and keeps state immutable", () => {
  const result = createTrayHealth({ ...HEALTHY, lastSuccessfulPollAt: new Date(NOW - 10_000) });
  assert.equal(result.lastSuccessfulPollAt, NOW - 10_000);
  assert.equal(result.lastSuccessfulPollAgeMs, 10_000);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.outputs), true);
});

test("contains only privacy-safe allow-listed fields", () => {
  const result = createTrayHealth({ ...HEALTHY, title: "Secret Movie", username: "alice", providerUrl: "https://private.invalid", token: "secret" });
  assert.deepEqual(Object.keys(result), ["status", "provider", "outputs", "lastSuccessfulPollAt", "lastSuccessfulPollAgeMs", "stale", "action"]);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["Secret Movie", "alice", "private.invalid", "token"]) assert.equal(serialized.includes(forbidden), false);
});

test("rejects unknown status text and invalid times without reflecting values", () => {
  assert.throws(() => createTrayHealth({ ...HEALTHY, provider: "token=secret" }), (error) => error.message === "tray health provider is invalid");
  assert.throws(() => createTrayHealth({ ...HEALTHY, card: "https://private.invalid" }), (error) => error.message === "tray health output is invalid");
  for (const value of [-1, Number.NaN, "yesterday"]) assert.throws(() => createTrayHealth({ ...HEALTHY, lastSuccessfulPollAt: value }), /lastSuccessfulPollAt is invalid/);
});
