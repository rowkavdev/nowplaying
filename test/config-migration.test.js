import test from "node:test";
import assert from "node:assert/strict";
import { migrateConfigDocument } from "../src/config-migration.js";

const migrations = [
  (value) => ({ version: 1, provider: value.service, settings: { discord: true } }),
  (value) => ({ ...value, version: 2, settings: { ...value.settings, idleBehavior: "clear" } }),
];
const validate = (value) => {
  if (value.version !== 2 || typeof value.provider !== "string" || value.settings?.idleBehavior !== "clear") throw new TypeError("invalid");
  return value;
};

test("migrates every supported source version one step at a time", () => {
  const fromZero = migrateConfigDocument({ document: { version: 0, service: "plex" }, currentVersion: 2, migrations, validate });
  assert.deepEqual(fromZero, { changed: true, sourceVersion: 0, targetVersion: 2, applied: ["0->1", "1->2"], document: { version: 2, provider: "plex", settings: { discord: true, idleBehavior: "clear" } } });
  const fromOne = migrateConfigDocument({ document: { version: 1, provider: "emby", settings: { discord: false } }, currentVersion: 2, migrations, validate });
  assert.deepEqual(fromOne.applied, ["1->2"]);
  assert.equal(fromOne.document.provider, "emby");
  assert.equal(fromOne.document.settings.discord, false);
});

test("validates an already-current document without reporting a change", () => {
  const document = { version: 2, provider: "plex", settings: { discord: true, idleBehavior: "clear" } };
  const result = migrateConfigDocument({ document, currentVersion: 2, migrations, validate });
  assert.equal(result.changed, false);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.document, document);
});

test("never mutates the source or migration-owned nested objects", () => {
  const document = { version: 0, service: "plex", nested: { keep: true } };
  const before = structuredClone(document);
  const result = migrateConfigDocument({ document, currentVersion: 2, migrations, validate });
  assert.deepEqual(document, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.document), true);
  assert.equal(Object.isFrozen(result.document.settings), true);
});

test("rejects malformed and future-version documents", () => {
  for (const document of [null, [], "text", { provider: "plex" }, { version: -1 }, { version: 1.5 }]) {
    assert.throws(() => migrateConfigDocument({ document, currentVersion: 2, migrations, validate }), /configuration/);
  }
  assert.throws(() => migrateConfigDocument({ document: { version: 3 }, currentVersion: 2, migrations, validate }), /newer than this app/);
});

test("rejects incomplete and out-of-sequence migration chains", () => {
  assert.throws(() => migrateConfigDocument({ document: { version: 0 }, currentVersion: 2, migrations: [migrations[0]], validate }), /incomplete/);
  const wrongVersion = [() => ({ version: 2 }), migrations[1]];
  assert.throws(() => migrateConfigDocument({ document: { version: 0 }, currentVersion: 2, migrations: wrongVersion, validate }), /produced an invalid version/);
});

test("sanitizes migration and validation failures", () => {
  const throwing = [() => { throw new Error("token=secret https://private.invalid"); }, migrations[1]];
  assert.throws(() => migrateConfigDocument({ document: { version: 0 }, currentVersion: 2, migrations: throwing, validate }), (error) => error.message === "configuration migration 0 failed");
  assert.throws(() => migrateConfigDocument({ document: { version: 2 }, currentVersion: 2, migrations, validate() { throw new Error("token=secret"); } }), (error) => error.message === "migrated configuration failed validation");
});

test("requires complete inputs", () => {
  assert.throws(() => migrateConfigDocument({ document: { version: 1 }, currentVersion: 0, migrations: [], validate }), /currentVersion/);
  assert.throws(() => migrateConfigDocument({ document: { version: 1 }, currentVersion: 2, migrations, validate: null }), /validator/);
});
