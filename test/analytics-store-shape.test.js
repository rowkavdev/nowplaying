import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAnalyticsStore } from "../src/analytics-store.js";

const valid = () => ({ version: 1, cards: 9, discords: 4, installations: ["old-id"], cardInstallations: ["old-id"], discordInstallations: [] });
const invalid = [];
for (const field of ["cards", "discords"]) {
  for (const value of ["9", null, undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, {}, []]) {
    invalid.push({ field, value });
  }
}
for (const field of ["installations", "cardInstallations", "discordInstallations"]) {
  for (const value of ["old-id", null, undefined, {}, [7], [null], [{}]]) {
    invalid.push({ field, value });
  }
}
for (const [index, { field, value }] of invalid.entries()) {
  test(`invalid v1 ${field} shape ${index} rejects reads and both records without touching history`, async () => {
    const root = await mkdtemp(join(tmpdir(), "analytics-shape-"));
    try {
      const file = join(root, "analytics.json");
      const original = JSON.stringify({ ...valid(), [field]: value }, null, 2) + "\n";
      await writeFile(file, original);
      await writeFile(`${file}.tmp`, "existing temporary file");
      const store = createAnalyticsStore({ file, salt: "a-private-random-salt" });
      await assert.rejects(store.stats(), /invalid analytics data/);
      await assert.rejects(store.recordCard("installation-0001"), /invalid analytics data/);
      await assert.rejects(store.recordDiscord("installation-0002"), /invalid analytics data/);
      assert.equal(await readFile(file, "utf8"), original);
      assert.equal(await readFile(`${file}.tmp`, "utf8"), "existing temporary file");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("shape rejection recovers after repair without discarding prior counts or IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "analytics-shape-repair-"));
  try {
    const file = join(root, "analytics.json");
    const store = createAnalyticsStore({ file, salt: "a-private-random-salt" });
    await writeFile(file, JSON.stringify({ ...valid(), cards: "9" }));
    const results = await Promise.allSettled([store.recordCard("installation-0001"), store.recordDiscord("installation-0002")]);
    assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
    await writeFile(file, JSON.stringify(valid()));
    await store.recordCard("installation-0001");
    await store.recordDiscord("installation-0002");
    assert.deepEqual(await store.stats(), { users: 3, cardsGenerated: 10, cardUsers: 2, discordEvents: 5, discordUsers: 1 });
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.installations[0], "old-id");
    assert.equal(saved.cardInstallations[0], "old-id");
  } finally { await rm(root, { recursive: true, force: true }); }
});
