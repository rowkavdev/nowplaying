import { createBuildProvenance } from "./build-provenance.js";

const REDACTED = "[redacted]";

/**
 * Remove values that must never appear in a support bundle.
 * Callers add known usernames and media titles through sensitiveValues.
 */
export function redactDiagnosticText(value, { sensitiveValues = [] } = {}) {
  let text = String(value ?? "");
  text = text.replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/gi, `${REDACTED}-credential`);
  text = text.replace(/\b(?:token|api[-_ ]?key|secret|password|authorization|webhook)\b\s*[:=]\s*[^\s,;]+/gi, (match) => `${match.split(/[:=]/, 1)[0]}=${REDACTED}`);
  text = text.replace(/\b(?:https?|wss?):\/\/[^\s<>'"`]+/gi, `${REDACTED}-url`);
  text = text.replace(/(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g, `${REDACTED}-ip`);
  text = text.replace(/(?<![\w:])(?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}(?![\w:])/gi, `${REDACTED}-ip`);
  text = text.replace(/([/\\](?:Users|home)[/\\])[^/\\\s]+/gi, `$1${REDACTED}-user`);
  for (const sensitive of normalizedSensitiveValues(sensitiveValues)) {
    text = text.replaceAll(sensitive, REDACTED);
  }
  return text;
}

/** Build an allow-listed, JSON-serializable diagnostic record. */
export function createDiagnosticRecord({ version, platform, packageType, enabledOutputs = [], provider, health, updater, tray, errors = [], sensitiveValues = [], build } = {}) {
  return Object.freeze({
    schemaVersion: 1,
    version: safeLabel(version),
    platform: safeLabel(platform),
    packageType: safeLabel(packageType),
    enabledOutputs: Object.freeze(enabledOutputs.map(safeLabel).filter(Boolean)),
    provider: Object.freeze({ type: safeLabel(provider?.type), status: safeLabel(provider?.status) }),
    health: safeLabel(health),
    updater: safeLabel(updater),
    tray: safeLabel(tray),
    errors: Object.freeze(errors.map((error) => redactDiagnosticText(error, { sensitiveValues }))),
    build: safeBuild(build),
  });
}

// Build details come from the packaged build-info.json; anything that
// doesn't validate is dropped rather than guessed.
function safeBuild(value) {
  if (value === undefined || value === null) return null;
  try { return createBuildProvenance(value); } catch { return null; }
}

function safeLabel(value) {
  if (typeof value !== "string") return null;
  const label = value.trim();
  return /^[a-z0-9][a-z0-9 ._+-]{0,63}$/i.test(label) ? label : null;
}

function normalizedSensitiveValues(values) {
  if (!Array.isArray(values)) throw new TypeError("sensitiveValues: expected an array");
  return [...new Set(values.filter((value) => typeof value === "string" && value.length >= 2))].sort((a, b) => b.length - a.length);
}
