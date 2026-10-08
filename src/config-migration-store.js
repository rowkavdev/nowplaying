import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
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
    // Match parseAppConfig (#522): drop one leading BOM (Notepad, PowerShell 5)
    // so an old-version config saved that way still migrates (#532).
    if (sourceText.charCodeAt(0) === 0xfeff) sourceText = sourceText.slice(1);
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
      // Take ownership before writing: failure to acquire wx must not delete
      // a temporary file belonging to another migration.
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(result.document, null, 2)}\n`);
        await handle.close();
        await rename(temporary, file);
      } catch (error) {
        await handle.close().catch(() => {});
        await rm(temporary, { force: true });
        throw error;
      }
    } catch {
      throw new Error("configuration migration could not be saved");
    }
    return Object.freeze({ changed: true, status: "migrated", backup, sourceVersion: result.sourceVersion, targetVersion: result.targetVersion, document: result.document });
  }

  return Object.freeze({ migrate });
}

async function copyFileExclusive(source, destination) {
  const handle = await open(destination, "wx", 0o600);
  try {
    // copyFile copies the source mode too, undoing the owner-only wx open.
    // Write through the exclusive handle so the backup stays private.
    await handle.writeFile(await readFile(source));
  } catch (error) {
    await handle.close();
    await rm(destination, { force: true });
    throw error;
  }
  await handle.close();
}

function canonicalTimestamp(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError("migration store clock returned an invalid date");
  return value.toISOString().replace(/[:.]/g, "-");
}
