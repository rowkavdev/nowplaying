import { copyFile, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { migrateConfigDocument } from "./config-migration.js";

export function createConfigMigrationStore({ file, currentVersion, migrations, validate, clock = () => new Date() } = {}) {
  if (typeof file !== "string" || !file) throw new TypeError("migration store file is required");
  if (typeof clock !== "function") throw new TypeError("migration store clock is required");

  async function migrate() {
    let sourceText;
    try { sourceText = await readFile(file, "utf8"); }
    catch (error) {
      if (error.code === "ENOENT") return Object.freeze({ changed: false, status: "missing", backup: null });
      throw new Error("configuration could not be read");
    }
    let document;
    try { document = JSON.parse(sourceText); }
    catch { throw new Error("configuration is malformed"); }

    const result = migrateConfigDocument({ document, currentVersion, migrations, validate });
    if (!result.changed) return Object.freeze({ changed: false, status: "current", backup: null, document: result.document });

    const timestamp = canonicalTimestamp(clock());
    const backup = `${file}.backup-${timestamp}`;
    const temporary = `${file}.migration-${timestamp}.tmp`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await copyFileExclusive(file, backup);
      await writeFile(temporary, `${JSON.stringify(result.document, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    } catch {
      await rm(temporary, { force: true });
      throw new Error("configuration migration could not be saved");
    }
    return Object.freeze({ changed: true, status: "migrated", backup, sourceVersion: result.sourceVersion, targetVersion: result.targetVersion, document: result.document });
  }

  return Object.freeze({ migrate });
}

async function copyFileExclusive(source, destination) {
  const handle = await open(destination, "wx", 0o600);
  await handle.close();
  try { await copyFile(source, destination); }
  catch (error) { await rm(destination, { force: true }); throw error; }
}

function canonicalTimestamp(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError("migration store clock returned an invalid date");
  return value.toISOString().replace(/[:.]/g, "-");
}
