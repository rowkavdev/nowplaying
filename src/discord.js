
import { createTemplateValues, formatTemplate, validateTemplate } from "./template.js";
import { FALLBACK_ARTWORK_URL, isDiscordImage } from "./discord-artwork.js";

// Films and TV show as "Watching"; music and anything unknown as "Listening" (#143).
const VIDEO_KINDS = new Set(["episode", "movie", "show"]);
const TIMESTAMP_MODES = new Set(["elapsed", "remaining", "both", "none"]);
const IDLE_BEHAVIORS = new Set(["clear", "show"]);


export const discordDefaults = Object.freeze({
  details: "{title}",
  state: "{subtitle}",
  largeText: "{stateLabel}",
  largeImage: FALLBACK_ARTWORK_URL,
  smallImage: "",
  timestamps: "both",
  idleBehavior: "clear",
  buttons: Object.freeze([]),
  minUpdateIntervalMs: 15_000,
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
    if (input[key] !== undefined && input[key] !== "" && !isDiscordImage(input[key])) {
      throw new TypeError(`discord.${key}: expected an asset key or a public HTTPS image URL`);
    }
  }
  if (input.timestamps !== undefined && !TIMESTAMP_MODES.has(input.timestamps)) {
    throw new TypeError("discord.timestamps: expected elapsed, remaining, both or none");
  }
  if (input.buttons !== undefined) validateButtons(input.buttons);
  if (input.minUpdateIntervalMs !== undefined && (!Number.isInteger(input.minUpdateIntervalMs) || input.minUpdateIntervalMs < 5_000 || input.minUpdateIntervalMs > 300_000)) {
    throw new RangeError("discord.minUpdateIntervalMs: expected an integer from 5000 to 300000");
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
    type: VIDEO_KINDS.has(presence.kind) ? "watching" : "listening",
    details: details || (presence.state === "idle" ? "Nothing playing" : undefined),
    state: state || undefined,
    largeImage: settings.largeImage || undefined,
    largeText: largeText || undefined,
    smallImage: settings.smallImage || undefined,
    buttons: settings.buttons.length ? settings.buttons.map((button) => Object.freeze({ ...button })) : undefined,
    ...timestampFields(presence, settings.timestamps),
  };
  return Object.freeze(Object.fromEntries(Object.entries(activity).filter(([, value]) => value !== undefined)));
}


function validateButtons(buttons) {
  if (!Array.isArray(buttons) || buttons.length > 2) throw new TypeError("discord.buttons: expected up to two buttons");
  for (const [index, button] of buttons.entries()) {
    if (!button || typeof button !== "object" || Array.isArray(button)) throw new TypeError(`discord.buttons.${index}: expected an object`);
    const keys = Object.keys(button);
    if (keys.some((key) => key !== "label" && key !== "url")) throw new TypeError(`discord.buttons.${index}: unknown setting`);
    if (typeof button.label !== "string" || button.label.length < 1 || button.label.length > 32) throw new TypeError(`discord.buttons.${index}.label: expected 1 to 32 characters`);
    let url;
    try { url = new URL(button.url); } catch { throw new TypeError(`discord.buttons.${index}.url: expected a valid HTTPS URL`); }
    if (url.protocol !== "https:" || url.username || url.password) throw new TypeError(`discord.buttons.${index}.url: expected a valid HTTPS URL`);
  }
}
