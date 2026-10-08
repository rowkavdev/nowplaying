import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSetupStore } from "../src/setup-store.js";

const input = (index) => ({ provider: "plex", identity: { id: `user-${index}`, displayName: `Name ${index}` }, credentialStored: true });

test("overlapping setup saves finish in invocation order without sharing a temporary write", async () => {
  const root = await mkdtemp(join(tmpdir(), "setup-queue-"));
  try {
    const store = createSetupStore({ file: join(root, "config.json") });
    const saves = Array.from({ length: 16 }, (_, index) => store.save(input(index)));
    const results = await Promise.allSettled(saves);
    assert.equal(results.filter((result) => result.status === "rejected").length, 0);
    assert.deepEqual(await store.load(), results.at(-1).value);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a load and reset called after save observe its invocation order", async () => {
  const root = await mkdtemp(join(tmpdir(), "setup-order-"));
  try {
    const store = createSetupStore({ file: join(root, "nested", "config.json") });
    const save = store.save(input(1));
    const load = store.load();
    const reset = store.reset();
    const saved = await save;
    assert.deepEqual(await load, saved);
    await reset;
    assert.equal(await store.load(), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a rejected setup save does not poison later queued operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "setup-order-recovery-"));
  try {
    const store = createSetupStore({ file: join(root, "config.json") });
    const invalid = store.save({ ...input(1), token: "secret-token" });
    const valid = store.save(input(2));
    const results = await Promise.allSettled([invalid, valid]);
    assert.equal(results[0].status, "rejected");
    assert.match(results[0].reason.message, /cannot contain credentials/);
    assert.equal(results[1].status, "fulfilled");
    assert.deepEqual(await store.load(), results[1].value);
    await store.reset();
    assert.equal(await store.load(), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
