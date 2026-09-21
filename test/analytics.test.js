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
