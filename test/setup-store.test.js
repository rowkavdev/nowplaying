import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSetupStore } from "../src/setup-store.js";

const input = {
  provider: "plex",
  identity: { id: "user-42", displayName: "Rowan" },
  credentialStored: true,
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nowplaying-setup-"));
  const file = join(root, "settings", "config.json");
  return { file, store: createSetupStore({ file }) };
}

test("atomically saves and loads reviewed setup", async () => {
  const { file, store } = await fixture();
  assert.equal(await store.load(), null);
  const saved = await store.save(input);
  assert.deepEqual(await store.load(), saved);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), saved);
  await assert.rejects(access(`${file}.tmp`, constants.F_OK), /ENOENT/);
});

test("validates before replacing an existing config", async () => {
  const { file, store } = await fixture();
  await store.save(input);
  const before = await readFile(file, "utf8");

  await assert.rejects(store.save({ ...input, token: "secret-token" }), /cannot contain credentials/);
  assert.equal(await readFile(file, "utf8"), before);
});

test("reset removes active and leftover temporary state", async () => {
  const { file, store } = await fixture();
  await store.save(input);
  await writeFile(`${file}.tmp`, "partial");
  await store.reset();

  assert.equal(await store.load(), null);
  await assert.rejects(access(`${file}.tmp`, constants.F_OK), /ENOENT/);
  await assert.doesNotReject(store.reset());
});

test("requires an explicit config path", () => {
  assert.throws(() => createSetupStore(), /file is required/);
});
