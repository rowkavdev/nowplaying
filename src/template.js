const TEMPLATE_PATTERN = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

export const templateFields = Object.freeze([
  "title",
  "subtitle",
  "album",
  "year",
  "series",
  "season",
  "episode",
  "episodeCode",
  "provider",
  "mediaType",
  "state",
  "stateLabel",
  "position",
  "duration",
  "progressPercent",
]);

const FIELD_SET = new Set(templateFields);

// "S02E05" when both numbers are known, "E05" or "S02" when only one is.
function episodeCode(season, episode) {
  const pad = (n) => String(n).padStart(2, "0");
  const s = Number.isInteger(season) ? `S${pad(season)}` : "";
  const e = Number.isInteger(episode) ? `E${pad(episode)}` : "";
  return s + e;
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function progressPercent(positionMs, durationMs) {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) return "";
  const bounded = Math.min(Math.max(positionMs, 0), durationMs);
  return String(Math.round((bounded / durationMs) * 100));
}

export function createTemplateValues(presence, { labels = {} } = {}) {
  if (presence === null || typeof presence !== "object" || Array.isArray(presence)) {
    throw new TypeError("presence: expected an object");
  }
  const stateLabels = {
    playing: "Playing",
    paused: "Paused",
    idle: "Idle",
    ...labels,
  };
  return Object.freeze({
    title: presence.title ?? "",
    subtitle: presence.subtitle ?? "",
    album: presence.album ?? "",
    year: presence.year == null ? "" : String(presence.year),
    series: presence.series ?? "",
    season: presence.season == null ? "" : String(presence.season),
    episode: presence.episode == null ? "" : String(presence.episode),
    episodeCode: episodeCode(presence.season, presence.episode),
    provider: presence.provider ?? "",
    mediaType: presence.mediaType ?? "",
    state: presence.state ?? "",
    stateLabel: stateLabels[presence.state] ?? presence.state ?? "",
    position: formatDuration(presence.positionMs),
    duration: formatDuration(presence.durationMs),
    progressPercent: progressPercent(presence.positionMs, presence.durationMs),
  });
}

export function validateTemplate(template, path = "template") {
  if (typeof template !== "string") {
    throw new TypeError(`${path}: expected a string`);
  }
  for (const match of template.matchAll(TEMPLATE_PATTERN)) {
    if (!FIELD_SET.has(match[1])) {
      throw new TypeError(`${path}: unknown field {${match[1]}}`);
    }
  }
  return template;
}

export function formatTemplate(template, values, { separator = " · ", emptyValue = "" } = {}) {
  validateTemplate(template);
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    throw new TypeError("values: expected an object");
  }
  if (typeof separator !== "string" || typeof emptyValue !== "string") {
    throw new TypeError("template options: separator and emptyValue must be strings");
  }

  const segments = separator === "" ? [template] : template.split(separator);
  const formatted = segments.flatMap((segment) => {
    const fields = [...segment.matchAll(TEMPLATE_PATTERN)].map((match) => match[1]);
    if (fields.length > 0 && fields.every((field) => values[field] == null || values[field] === "")) {
      return [];
    }
    const text = segment.replace(TEMPLATE_PATTERN, (_match, field) => {
      const value = values[field];
      return value == null || value === "" ? emptyValue : String(value);
    }).trim();
    return text === "" ? [] : [text];
  });

  return formatted.join(separator);
}
