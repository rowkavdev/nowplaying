import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordAnalytics, withCardAnalytics } from "../src/analytics.js";

test("counts only successfully rendered cards", async () => {
  const seen = [];
  const resolve = withCardAnalytics(async () => "<svg/>", { store: { recordCard: async (id) => seen.push(id) }, installationId: "anonymous-install-01" });
  assert.equal(await resolve(), "<svg/>");
  assert.deepEqual(seen, ["anonymous-install-01"]);
});

test("Discord analytics is opt-in and sends once per process", async () => {
  let calls = 0;
  const disabled = createDiscordAnalytics({ enabled: false, installationId: "anonymous-install-01" });
  assert.deepEqual(await disabled.ping(), { sent: false });
  const enabled = createDiscordAnalytics({ enabled: true, endpoint: "https://stats.example.test", installationId: "anonymous-install-01", fetchImpl: async () => { calls += 1; return { ok: true }; } });
  assert.deepEqual(await enabled.ping(), { sent: true });
  assert.deepEqual(await enabled.ping(), { sent: false });
  assert.equal(calls, 1);
});

test("enabled Discord analytics requires HTTPS", () => {
  assert.throws(() => createDiscordAnalytics({ enabled: true, endpoint: "http://localhost", installationId: "anonymous-install-01" }), /HTTPS/);
});

test("overlapping Discord pings send one request and a failed ping can be retried", async () => {
  let calls = 0; let release; let ok = true;
  const gate = new Promise((resolve) => { release = resolve; });
  const analytics = createDiscordAnalytics({ enabled: true, endpoint: "https://stats.example.test", installationId: "anonymous-install-01", fetchImpl: async () => { calls += 1; await gate; return { ok, status: ok ? 200 : 503 }; } });
  ok = false;
  const first = analytics.ping(); const second = analytics.ping();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await second, { sent: false });
  await assert.rejects(first, /503/);
  ok = true;
  assert.deepEqual(await analytics.ping(), { sent: true });
  assert.equal(calls, 2);
  assert.deepEqual(await analytics.ping(), { sent: false });
  assert.equal(calls, 2);
});

test("a failing analytics write does not fail the card", async () => {
  const resolve = withCardAnalytics(async () => "<svg/>", { store: { recordCard: async () => { throw new Error("disk full"); } }, installationId: "anonymous-installation" });
  assert.equal(await resolve({}), "<svg/>");
});
