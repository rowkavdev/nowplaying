
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

// Episodes read better as "Lost" / "S04E05 · The Constant" (#143). These only
// replace details or state when that field is still the plain default, so a
// custom template always wins. Without a series name the plain defaults stay.
const EPISODE_DEFAULTS = Object.freeze({ details: "{series}", state: "{episodeCode} · {title}" });

function templatesFor(presence, input, settings) {
  if (presence.kind !== "episode" || !presence.series) return settings;
  const pick = (key) => input[key] === undefined || input[key] === discordDefaults[key] ? EPISODE_DEFAULTS[key] : settings[key];
  return { ...settings, details: pick("details"), state: pick("state") };
}

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

// Discord rejects the whole activity when a text field is 1 character long
// ("details length must be at least 2 characters long"), so a track called
// "i" or an album called "?" would never show. Pad with a blank Braille
// character, which Discord shows as empty space.
// The 128 limit counts UTF-16 units (JavaScript string length), so an emoji
// uses two. Cut whole code points only, so a surrogate pair is never split.
function trimDiscordText(value) {
  const chars = [];
  let units = 0;
  for (const char of value) {
    if (units + char.length > 128) break;
    chars.push(char);
    units += char.length;
  }
  if (chars.length === 1) chars.push("\u2800");
  return chars.join("");
}

export function formatDiscordActivity(presence, input = {}) {
  validateDiscordSettings(input);
  const settings = templatesFor(presence, input, { ...discordDefaults, ...input });
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
