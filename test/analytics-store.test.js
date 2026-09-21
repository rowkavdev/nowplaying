import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAnalyticsStore } from "../src/analytics-store.js";

test("persists aggregate event and distinct installation counts", async () => {
  const root = await mkdtemp(join(tmpdir(), "analytics-test-"));
  const options = { file: join(root, "analytics.json"), salt: "a-private-random-salt" };
  const store = createAnalyticsStore(options);
  await Promise.all([store.recordCard("installation-0001"), store.recordCard("installation-0001"), store.recordCard("installation-0002"), store.recordDiscord("installation-0002")]);
  assert.deepEqual(await store.stats(), { users: 2, cardsGenerated: 3, cardUsers: 2, discordEvents: 1, discordUsers: 1 });
  assert.deepEqual(await createAnalyticsStore(options).stats(), { users: 2, cardsGenerated: 3, cardUsers: 2, discordEvents: 1, discordUsers: 1 });
});

test("rejects unbounded identifiers and event names", async () => {
  const store = createAnalyticsStore({ file: "/tmp/unused-analytics.json", salt: "a-private-random-salt" });
  await assert.rejects(store.recordCard("short"), /16-128/);
  assert.throws(() => createAnalyticsStore({ file: "x", salt: "short" }), /at least 16/);
});
