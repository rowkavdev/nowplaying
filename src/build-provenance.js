const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const COMMIT = /^[a-f0-9]{40}$/;
const CHANNELS = new Set(["stable", "beta", "development"]);

/** Validate provenance embedded by the package build, never inferred at runtime. */
export function createBuildProvenance(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("build provenance is required");
  const version = requiredString(input.version, "version");
  if (!VERSION.test(version)) throw new TypeError("build provenance version is invalid");
  const commitSha = requiredString(input.commitSha, "commitSha").toLowerCase();
  if (!COMMIT.test(commitSha)) throw new TypeError("build provenance commitSha is invalid");
  const buildTime = requiredString(input.buildTime, "buildTime");
  if (!isCanonicalIsoInstant(buildTime)) throw new TypeError("build provenance buildTime is invalid");
  const channel = requiredString(input.channel, "channel").toLowerCase();
  if (!CHANNELS.has(channel)) throw new TypeError("build provenance channel is invalid");
  if (typeof input.signed !== "boolean") throw new TypeError("build provenance signed is invalid");
  return Object.freeze({ version, commitSha, buildTime, channel, signed: input.signed });
}

export function formatBuildProvenance(input) {
  const value = createBuildProvenance(input);
  return Object.freeze({ ...value, signature: value.signed ? "signed" : "unsigned" });
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() !== value || !value) throw new TypeError(`build provenance ${field} is required`);
  return value;
}

function isCanonicalIsoInstant(value) {
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
}
