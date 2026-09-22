/**
 * Apply configuration migrations one version at a time without mutating input.
 * Persistence and backup happen only after this returns a validated document.
 */
export function migrateConfigDocument({ document, currentVersion, migrations, validate } = {}) {
  if (!isPlainObject(document)) throw new TypeError("configuration is malformed");
  if (!Number.isInteger(currentVersion) || currentVersion < 1) throw new TypeError("currentVersion is invalid");
  if (!Array.isArray(migrations) || migrations.length !== currentVersion) throw new TypeError("configuration migrations are incomplete");
  if (typeof validate !== "function") throw new TypeError("configuration validator is required");

  const sourceVersion = document.version;
  if (!Number.isInteger(sourceVersion) || sourceVersion < 0) throw new TypeError("configuration version is invalid");
  if (sourceVersion > currentVersion) throw new RangeError("configuration version is newer than this app");

  let value = structuredClone(document);
  const applied = [];
  for (let version = sourceVersion; version < currentVersion; version += 1) {
    const migrate = migrations[version];
    if (typeof migrate !== "function") throw new TypeError(`configuration migration ${version} is unavailable`);
    let next;
    try { next = migrate(structuredClone(value)); }
    catch { throw new Error(`configuration migration ${version} failed`); }
    if (!isPlainObject(next) || next.version !== version + 1) throw new Error(`configuration migration ${version} produced an invalid version`);
    value = structuredClone(next);
    applied.push(`${version}->${version + 1}`);
  }

  let validated;
  try { validated = validate(structuredClone(value)); }
  catch { throw new Error("migrated configuration failed validation"); }
  if (!isPlainObject(validated) || validated.version !== currentVersion) throw new Error("migrated configuration failed validation");
  return Object.freeze({ changed: applied.length > 0, sourceVersion, targetVersion: currentVersion, applied: Object.freeze(applied), document: deepFreeze(structuredClone(validated)) });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
