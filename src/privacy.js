import { createPresence } from "./presence.js";

const PRIVACY_MODES = new Set(["private", "friends", "public", "custom"]);
const MEDIA_KINDS = new Set(["movie", "episode", "track", "show", "unknown"]);

export const privacyDefaults = Object.freeze({
  mode: "public",
  hideUsers: true,
  hideProviders: true,
  hideArtwork: false,
  redactTitles: false,
  hideProgress: false,
  suppressMediaKinds: Object.freeze([]),
  titleReplacement: "Private media",
});

function assertObject(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path}: expected an object`);
}

export function validatePrivacyPolicy(input = {}) {
  assertObject(input, "privacy");
  const allowed = new Set(Object.keys(privacyDefaults));
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`privacy.${key}: unknown setting`);
  if (input.mode !== undefined && !PRIVACY_MODES.has(input.mode)) throw new TypeError("privacy.mode: expected private, friends, public or custom");
  for (const key of ["hideUsers", "hideProviders", "hideArtwork", "redactTitles", "hideProgress"]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean") throw new TypeError(`privacy.${key}: expected a boolean`);
  }
  if (input.titleReplacement !== undefined && (typeof input.titleReplacement !== "string" || input.titleReplacement.length > 128)) throw new TypeError("privacy.titleReplacement: expected a string up to 128 characters");
  if (input.suppressMediaKinds !== undefined) {
    if (!Array.isArray(input.suppressMediaKinds)) throw new TypeError("privacy.suppressMediaKinds: expected an array");
    for (const kind of input.suppressMediaKinds) if (!MEDIA_KINDS.has(kind)) throw new TypeError(`privacy.suppressMediaKinds: unknown media kind ${String(kind)}`);
  }
  return input;
}

export function createPrivacyPolicy(input = {}) {
  validatePrivacyPolicy(input);
  return Object.freeze({ ...privacyDefaults, ...input, suppressMediaKinds: Object.freeze([...(input.suppressMediaKinds ?? privacyDefaults.suppressMediaKinds)]) });
}

export function applyPrivacy(presence, input = {}) {
  assertObject(presence, "presence");
  const policy = createPrivacyPolicy(input);
  if (policy.mode === "private" || policy.suppressMediaKinds.includes(presence.kind)) return createPresence({ state: "idle", updatedAt: presence.updatedAt });
  return createPresence({
    ...presence,
    title: policy.redactTitles && presence.state !== "idle" ? policy.titleReplacement : presence.title,
    subtitle: policy.redactTitles ? null : presence.subtitle,
    artwork: policy.hideArtwork ? null : presence.artwork,
    artworkUrl: policy.hideArtwork ? null : presence.artworkUrl,
    positionMs: policy.hideProgress ? null : presence.positionMs,
    durationMs: policy.hideProgress ? null : presence.durationMs,
  });
}
