
const PRIVACY_MODES = new Set(["private", "friends", "public", "custom"]);
const CARD_THEMES = new Set(["midnight-blue", "paper", "compact"]);
const TIMESTAMP_MODES = new Set(["elapsed", "remaining", "both", "none"]);
const IDLE_BEHAVIORS = new Set(["clear", "grace", "show", "recent"]);

export const defaultSettings = Object.freeze({
  locale: "en-GB",
  privacy: Object.freeze({
    mode: "public",
    hideUsers: true,
    hideProviders: true,
    hideArtwork: false,
    redactTitles: false,
  }),
  format: Object.freeze({
    title: "{title}",
    details: "{subtitle}",
    state: "{stateLabel}",
    separator: " · ",
    emptyValue: "",
  }),
  card: Object.freeze({
    theme: "midnight-blue",
    width: 420,
    show: Object.freeze({
      provider: false,
      mediaType: true,
      year: true,
      progress: true,
      artwork: true,
      state: true,
    }),
  }),
  discord: Object.freeze({
    enabled: false,
    details: "{title}",
    state: "{subtitle}",
    timestamps: "elapsed",
    idleBehavior: "clear",
  }),
});

const ROOT_KEYS = new Set(["locale", "privacy", "format", "card", "discord"]);
const KEYS = Object.freeze({
  privacy: new Set(Object.keys(defaultSettings.privacy)),
  format: new Set(Object.keys(defaultSettings.format)),
  card: new Set(["theme", "width", "show"]),
  cardShow: new Set(Object.keys(defaultSettings.card.show)),
  discord: new Set(Object.keys(defaultSettings.discord)),
});

function assertObject(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path}: expected an object`);
  }
}

function rejectUnknown(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${path}.${key}: unknown setting`);
    }
  }
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${path}: expected a boolean`);
  }
}

function assertString(value, path, { min = 0, max = 256 } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new TypeError(`${path}: expected a string between ${min} and ${max} characters`);
  }
}

function validatePrivacy(value) {
  assertObject(value, "privacy");
  rejectUnknown(value, KEYS.privacy, "privacy");
  if (value.mode !== undefined && !PRIVACY_MODES.has(value.mode)) {
    throw new TypeError("privacy.mode: expected private, friends, public or custom");
  }
  for (const key of ["hideUsers", "hideProviders", "hideArtwork", "redactTitles"]) {
    if (value[key] !== undefined) assertBoolean(value[key], `privacy.${key}`);
  }
}

function validateFormat(value) {
  assertObject(value, "format");
  rejectUnknown(value, KEYS.format, "format");
  for (const key of KEYS.format) {
    if (value[key] !== undefined) assertString(value[key], `format.${key}`);
  }
}

function validateCard(value) {
  assertObject(value, "card");
  rejectUnknown(value, KEYS.card, "card");
  if (value.theme !== undefined && !CARD_THEMES.has(value.theme)) {
    throw new TypeError("card.theme: expected midnight-blue, paper or compact");
  }
  if (value.width !== undefined && (!Number.isInteger(value.width) || value.width < 280 || value.width > 800)) {
    throw new TypeError("card.width: must be an integer between 280 and 800");
  }
  if (value.show !== undefined) {
    assertObject(value.show, "card.show");
    rejectUnknown(value.show, KEYS.cardShow, "card.show");
    for (const key of KEYS.cardShow) {
      if (value.show[key] !== undefined) assertBoolean(value.show[key], `card.show.${key}`);
    }
  }
}

function validateDiscord(value) {
  assertObject(value, "discord");
  rejectUnknown(value, KEYS.discord, "discord");
  if (value.enabled !== undefined) assertBoolean(value.enabled, "discord.enabled");
  for (const key of ["details", "state"]) {
    if (value[key] !== undefined) assertString(value[key], `discord.${key}`, { max: 128 });
  }
  if (value.timestamps !== undefined && !TIMESTAMP_MODES.has(value.timestamps)) {
    throw new TypeError("discord.timestamps: expected elapsed, remaining, both or none");
  }
  if (value.idleBehavior !== undefined && !IDLE_BEHAVIORS.has(value.idleBehavior)) {
    throw new TypeError("discord.idleBehavior: expected clear, grace, show or recent");
  }
}

export function validateSettings(input = {}) {
  assertObject(input, "settings");
  rejectUnknown(input, ROOT_KEYS, "settings");
  if (input.locale !== undefined) assertString(input.locale, "locale", { min: 2, max: 35 });
  if (input.privacy !== undefined) validatePrivacy(input.privacy);
  if (input.format !== undefined) validateFormat(input.format);
  if (input.card !== undefined) validateCard(input.card);
  if (input.discord !== undefined) validateDiscord(input.discord);
  return input;
}

export function createSettings(input = {}) {
  validateSettings(input);
  const settings = {
    locale: input.locale ?? defaultSettings.locale,
    privacy: { ...defaultSettings.privacy, ...input.privacy },
    format: { ...defaultSettings.format, ...input.format },
    card: {
      ...defaultSettings.card,
      ...input.card,
      show: { ...defaultSettings.card.show, ...input.card?.show },
    },
    discord: { ...defaultSettings.discord, ...input.discord },
  };

  Object.freeze(settings.privacy);
  Object.freeze(settings.format);
  Object.freeze(settings.card.show);
  Object.freeze(settings.card);
  Object.freeze(settings.discord);
  return Object.freeze(settings);
}
