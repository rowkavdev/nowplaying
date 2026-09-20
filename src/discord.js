import { createTemplateValues, formatTemplate, validateTemplate } from "./template.js";

const TIMESTAMP_MODES = new Set(["elapsed", "remaining", "both", "none"]);
const IDLE_BEHAVIORS = new Set(["clear", "show"]);
const ASSET_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export const discordDefaults = Object.freeze({
  details: "{title}",
  state: "{subtitle}",
  largeText: "{stateLabel}",
  largeImage: "media",
  smallImage: "",
  timestamps: "elapsed",
  idleBehavior: "clear",
});

export function validateDiscordSettings(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("discord: expected an object");
  }
  const allowed = new Set(Object.keys(discordDefaults));
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`discord.${key}: unknown setting`);
  }
  for (const key of ["details", "state", "largeText"]) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "string" || input[key].length > 128) {
        throw new TypeError(`discord.${key}: expected a string up to 128 characters`);
      }
      validateTemplate(input[key], `discord.${key}`);
    }
  }
  for (const key of ["largeImage", "smallImage"]) {
    if (input[key] !== undefined && input[key] !== "" && (typeof input[key] !== "string" || !ASSET_PATTERN.test(input[key]))) {
      throw new TypeError(`discord.${key}: expected an asset key`);
    }
  }
  if (input.timestamps !== undefined && !TIMESTAMP_MODES.has(input.timestamps)) {
    throw new TypeError("discord.timestamps: expected elapsed, remaining, both or none");
  }
  if (input.idleBehavior !== undefined && !IDLE_BEHAVIORS.has(input.idleBehavior)) {
    throw new TypeError("discord.idleBehavior: expected clear or show");
  }
  return input;
}

function timestampFields(presence, mode) {
  if (presence.state !== "playing" || !Number.isFinite(presence.positionMs)) return {};
  const observedAt = Date.parse(presence.updatedAt);
  if (!Number.isFinite(observedAt)) return {};
  const startTimestamp = Math.floor((observedAt - presence.positionMs) / 1000);
  const hasEnd = Number.isFinite(presence.durationMs) && presence.durationMs > 0;
  const endTimestamp = hasEnd ? Math.floor((observedAt + presence.durationMs - presence.positionMs) / 1000) : undefined;
  if (mode === "none") return {};
  if (mode === "remaining") return endTimestamp === undefined ? {} : { endTimestamp };
  if (mode === "both") return endTimestamp === undefined ? { startTimestamp } : { startTimestamp, endTimestamp };
  return { startTimestamp };
}

function trimDiscordText(value) {
  return [...value].slice(0, 128).join("");
}

export function formatDiscordActivity(presence, input = {}) {
  validateDiscordSettings(input);
  const settings = { ...discordDefaults, ...input };
  if (presence.state === "idle" && settings.idleBehavior === "clear") return null;
  const values = createTemplateValues(presence);
  const details = trimDiscordText(formatTemplate(settings.details, values));
  const state = trimDiscordText(formatTemplate(settings.state, values));
  const largeText = trimDiscordText(formatTemplate(settings.largeText, values));
  const activity = {
    type: "watching",
    details: details || (presence.state === "idle" ? "Nothing playing" : undefined),
    state: state || undefined,
    largeImage: settings.largeImage || undefined,
    largeText: largeText || undefined,
    smallImage: settings.smallImage || undefined,
    ...timestampFields(presence, settings.timestamps),
  };
  return Object.freeze(Object.fromEntries(Object.entries(activity).filter(([, value]) => value !== undefined)));
}
