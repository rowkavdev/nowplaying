import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStartupRecoveryStore } from "../src/startup-recovery-store.js";

test("overlapping startup recovery saves commit in invocation order without sharing a temp write", async () => {
  const root = await mkdtemp(join(tmpdir(), "np-recovery-queue-"));
  const file = join(root, "recovery.json");
  const store = createStartupRecoveryStore({ file });
  try {
    const saves = Array.from({ length: 16 }, (_, index) => store.save({ failures: index + 1, subsystem: "provider" }));
    const outcomes = await Promise.allSettled(saves);
    assert.equal(outcomes.filter(result => result.status === "rejected").length, 0);
    assert.equal(JSON.parse(await readFile(file, "utf8")).failures, 16);
    assert.equal((await store.load()).failures, 16);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a failed recovery save does not poison the next save", async () => {
  const root = await mkdtemp(join(tmpdir(), "np-recovery-queue-failure-"));
  const blocked = join(root, "blocked");
  const file = join(blocked, "recovery.json");
  const store = createStartupRecoveryStore({ file });
  try {
    await writeFile(blocked, "not a directory");
    await assert.rejects(store.save({ failures: 1, subsystem: "provider" }));
    await rm(blocked);
    await mkdir(blocked);
    await store.save({ failures: 0, subsystem: null });
    assert.equal((await store.load()).failures, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
