import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigMigrationStore } from "../src/config-migration-store.js";

for (const backupCollision of [false, true]) {
  test(`migration failure preserves another operation's temporary file (backup collision ${backupCollision})`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-migration-collision-"));
    const file = join(dir, "config.json");
    const suffix = "2026-09-23T00-30-00-000Z";
    const temporary = `${file}.migration-${suffix}.tmp`;
    const original = '{"version":0,"service":"plex"}\n';
    try {
      await writeFile(file, original);
      await writeFile(temporary, "other migration data");
      if (backupCollision) await writeFile(`${file}.backup-${suffix}`, "other backup data");
      const store = createConfigMigrationStore({ file, currentVersion: 1,
        migrations: [(value) => ({ version: 1, provider: value.service })], validate: (value) => value,
        clock: () => new Date("2026-09-23T00:30:00.000Z"),
      });
      await assert.rejects(store.migrate(), /could not be saved/);
      assert.equal(await readFile(file, "utf8"), original);
      assert.equal(await readFile(temporary, "utf8"), "other migration data");
      if (backupCollision) assert.equal(await readFile(`${file}.backup-${suffix}`, "utf8"), "other backup data");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
