import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConfigMigrationStore } from "../src/config-migration-store.js";

const NOW = new Date("2026-09-23T00:30:00.000Z");
const migrations = [(value) => ({ version: 1, provider: value.service })];
const validate = (value) => {
  if (value.version !== 1 || typeof value.provider !== "string") throw new TypeError("invalid");
  return value;
};

async function fixture(text) {
  const root = await mkdtemp(join(tmpdir(), "nowplaying-migration-"));
  const file = join(root, "settings", "config.json");
  if (text !== undefined) {
    await writeFile(join(root, "placeholder"), "");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "settings"), { recursive: true }));
    await writeFile(file, text, { mode: 0o600 });
  }
  return { file, store: createConfigMigrationStore({ file, currentVersion: 1, migrations, validate, clock: () => NOW }) };
}

test("backs up exact bytes before atomically replacing a migrated config", async () => {
  const original = '{\n  "version": 0,\n  "service": "plex"\n}\n';
  const { file, store } = await fixture(original);
  const result = await store.migrate();
  assert.equal(result.changed, true);
  assert.equal(result.status, "migrated");
  assert.equal(result.backup, `${file}.backup-2026-09-23T00-30-00-000Z`);
  assert.equal(await readFile(result.backup, "utf8"), original);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1, provider: "plex" });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(result.backup)).mode & 0o777, 0o600);
  await assert.rejects(access(`${file}.migration-2026-09-23T00-30-00-000Z.tmp`, constants.F_OK), /ENOENT/);
});

test("leaves missing configuration untouched", async () => {
  const { store } = await fixture();
  assert.deepEqual(await store.migrate(), { changed: false, status: "missing", backup: null });
});

test("leaves a validated current configuration untouched without a backup", async () => {
  const text = '{"version":1,"provider":"emby"}\n';
  const { file, store } = await fixture(text);
  const result = await store.migrate();
  assert.equal(result.changed, false);
  assert.equal(result.status, "current");
  assert.equal(result.backup, null);
  assert.equal(await readFile(file, "utf8"), text);
});

test("malformed input never creates a backup or replaces the source", async () => {
  const text = "{ token=secret https://private.invalid";
  const { file, store } = await fixture(text);
  await assert.rejects(store.migrate(), (error) => error.message === "configuration is malformed");
  assert.equal(await readFile(file, "utf8"), text);
  await assert.rejects(access(`${file}.backup-2026-09-23T00-30-00-000Z`, constants.F_OK), /ENOENT/);
});

test("migration validation failure preserves the source without a backup", async () => {
  const text = '{"version":0,"service":"plex"}\n';
  const { file } = await fixture(text);
  const store = createConfigMigrationStore({ file, currentVersion: 1, migrations, validate() { throw new Error("token=secret"); }, clock: () => NOW });
  await assert.rejects(store.migrate(), /failed validation/);
  assert.equal(await readFile(file, "utf8"), text);
});

test("save failure keeps the active source and sanitizes the error", async () => {
  const text = '{"version":0,"service":"plex"}\n';
  const { file, store } = await fixture(text);
  await chmod(file, 0o400);
  await writeFile(`${file}.backup-2026-09-23T00-30-00-000Z`, "collision");
  await assert.rejects(store.migrate(), (error) => error.message === "configuration migration could not be saved");
  assert.equal(await readFile(file, "utf8"), text);
});

test("requires a file and valid clock", () => {
  assert.throws(() => createConfigMigrationStore(), /file is required/);
  assert.throws(() => createConfigMigrationStore({ file: "config.json", clock: null }), /clock is required/);
});
