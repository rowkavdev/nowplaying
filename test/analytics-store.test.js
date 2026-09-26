import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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


test("a failed write rejects its caller but later records and stats recover", async () => {
  const root = await mkdtemp(join(tmpdir(), "analytics-recovery-"));
  const file = join(root, "analytics.json");
  const store = createAnalyticsStore({ file, salt: "a-private-random-salt" });
  await writeFile(file, "{not json");
  await assert.rejects(store.recordCard("installation-0001"), SyntaxError);
  // The file was repaired; the store must not keep throwing the old error.
  await writeFile(file, JSON.stringify({ version: 1, cards: 0, discords: 0, installations: [], cardInstallations: [], discordInstallations: [] }));
  await store.recordCard("installation-0001");
  await store.recordDiscord("installation-0002");
  assert.deepEqual(await store.stats(), { users: 2, cardsGenerated: 1, cardUsers: 1, discordEvents: 1, discordUsers: 1 });
  assert.equal(JSON.parse(await readFile(file, "utf8")).cards, 1);
});

test("a queued record after failure gets its own result, not the old error", async () => {
  const root = await mkdtemp(join(tmpdir(), "analytics-queued-"));
  const file = join(root, "analytics.json");
  const store = createAnalyticsStore({ file, salt: "a-private-random-salt" });
  await writeFile(file, "{not json");
  const first = store.recordCard("installation-0001");
  const second = store.recordCard("installation-0002");
  const results = await Promise.allSettled([first, second]);
  assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected"]);
  assert.ok(results.every((r) => r.reason instanceof SyntaxError));
  await writeFile(file, JSON.stringify({ version: 1, cards: 0, discords: 0, installations: [], cardInstallations: [], discordInstallations: [] }));
  assert.deepEqual(await store.stats(), { users: 0, cardsGenerated: 0, cardUsers: 0, discordEvents: 0, discordUsers: 0 });
});
