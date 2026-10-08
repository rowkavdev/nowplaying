import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigMigrationStore } from "../src/config-migration-store.js";

for (const mode of [0o644, 0o640]) {
  test(`migration backup does not inherit permissive source mode ${mode.toString(8)}`, { skip: process.platform === "win32" }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "np-migration-mode-"));
    const file = join(dir, "config.json");
    const original = '\ufeff{\n  "version": 0,\n  "service": "plex"\n}\n';
    try {
      await writeFile(file, original);
      await chmod(file, mode);
      const store = createConfigMigrationStore({ file, currentVersion: 1,
        migrations: [(value) => ({ version: 1, provider: value.service })], validate: (value) => value,
      });
      const result = await store.migrate();
      assert.equal(await readFile(result.backup, "utf8"), original, "backup retains exact bytes including the BOM");
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.equal((await stat(result.backup)).mode & 0o777, 0o600, "backup remains owner-only");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
