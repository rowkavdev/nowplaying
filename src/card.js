export const cardThemes = Object.freeze({
  "midnight-blue": Object.freeze({ background: "#0d1117", border: "#30363d", primary: "#f0f6fc", secondary: "#9aa7b7", accent: "#58a6ff", track: "#30363d" }),
  paper: Object.freeze({ background: "#ffffff", border: "#c7d2df", primary: "#172033", secondary: "#526173", accent: "#0969da", track: "#d8e0e8" }),
  compact: Object.freeze({ background: "#0d1117", border: "#30363d", primary: "#f0f6fc", secondary: "#9aa7b7", accent: "#58a6ff", track: "#30363d" }),
});

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const SHOW_DEFAULTS = Object.freeze({ artwork: true, mediaType: true, progress: true, state: true, subtitle: true });
const COMPACT_SHOW = Object.freeze({ artwork: false, progress: false, state: false, subtitle: false });

export function resolveCardTheme(theme = "midnight-blue", colors = {}) {
  if (!Object.hasOwn(cardThemes, theme)) throw new TypeError(`Unknown card theme: ${theme}`);
  if (colors === null || typeof colors !== "object" || Array.isArray(colors)) throw new TypeError("colors must be an object");
  const resolved = { ...cardThemes[theme] };
  for (const [key, value] of Object.entries(colors)) {
    if (!Object.hasOwn(resolved, key)) throw new TypeError(`Unknown card color: ${key}`);
    if (typeof value !== "string" || !COLOR_PATTERN.test(value)) throw new TypeError(`card.colors.${key} must be a six-digit hex color`);
    resolved[key] = value.toLowerCase();
  }
  return Object.freeze(resolved);
}

export function renderCard(presence, { width = 440, show = {}, theme = "midnight-blue", colors = {}, artworkDataUri = null, layout = {} } = {}) {
  if (!Number.isInteger(width) || width < 280 || width > 800) throw new RangeError("width must be an integer from 280 to 800");
  if (show === null || typeof show !== "object" || Array.isArray(show)) throw new TypeError("show must be an object");
  if (layout === null || typeof layout !== "object" || Array.isArray(layout)) throw new TypeError("layout must be an object");
  const allowedLayout = new Set(["padding", "radius", "titleSize", "subtitleSize", "progressHeight"]);
  for (const key of Object.keys(layout)) if (!allowedLayout.has(key)) throw new TypeError(`Unknown card layout setting: ${key}`);
  const padding = bounded(layout.padding, 24, 12, 48, "layout.padding");
  const radius = bounded(layout.radius, 10, 0, 24, "layout.radius");
  const titleSize = bounded(layout.titleSize, 20, 14, 30, "layout.titleSize");
  const subtitleSize = bounded(layout.subtitleSize, 14, 10, 20, "layout.subtitleSize");
  const progressHeight = bounded(layout.progressHeight, 4, 2, 12, "layout.progressHeight");
  if (artworkDataUri !== null && (typeof artworkDataUri !== "string" || !DATA_IMAGE_PATTERN.test(artworkDataUri))) throw new TypeError("artworkDataUri must be a validated raster data URI");
  const presetShow = theme === "compact" ? COMPACT_SHOW : {};
  const visibility = { ...SHOW_DEFAULTS, ...presetShow, ...show };
  for (const [key, value] of Object.entries(visibility)) {
    if (!Object.hasOwn(SHOW_DEFAULTS, key)) throw new TypeError(`Unknown card visibility setting: ${key}`);
    if (typeof value !== "boolean") throw new TypeError(`card.show.${key} must be a boolean`);
  }
  const palette = resolveCardTheme(theme, colors);
  const hasArtwork = visibility.artwork && artworkDataUri !== null;
  const artworkWidth = 68;
  const contentX = hasArtwork ? padding + artworkWidth + 24 : padding;
  const contentWidth = width - contentX - padding;
  const status = presence.state === "playing" ? "NOW PLAYING" : presence.state === "paused" ? "PAUSED" : "NOT PLAYING";
  const title = presence.title || "Nothing playing";
  const subtitle = presence.subtitle || (visibility.mediaType ? providerLabel(presence.kind) : "");
  const hasSubtitle = visibility.subtitle && subtitle;
  const height = Math.max(hasArtwork ? padding * 2 + 100 : 74, padding * 2 + titleSize + (visibility.state ? 22 : 0) + (hasSubtitle ? subtitleSize + 10 : 0) + (visibility.progress ? progressHeight + 16 : 0));
  const titleY = padding + (visibility.state ? 40 : titleSize);
  const subtitleY = titleY + subtitleSize + 10;
  const progressY = height - padding;
  const progress = progressWidth(presence, contentWidth);
  const description = subtitle || status;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(status)}: ${escapeXml(title)}</title><desc id="desc">${escapeXml(description)}</desc>
  <rect width="100%" height="100%" rx="${radius}" fill="${palette.background}" stroke="${palette.border}"/>
  ${hasArtwork ? `<defs><clipPath id="art"><rect x="${padding}" y="${padding}" width="${artworkWidth}" height="100" rx="${Math.min(radius, 12)}"/></clipPath></defs><image href="${artworkDataUri}" x="${padding}" y="${padding}" width="${artworkWidth}" height="100" preserveAspectRatio="xMidYMid slice" clip-path="url(#art)"/>` : ""}
  ${visibility.state ? `<text x="${contentX}" y="${padding + 6}" fill="${palette.accent}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" font-weight="700" letter-spacing="1.4">${status}</text>` : ""}
  <text x="${contentX}" y="${titleY}" fill="${palette.primary}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${titleSize}" font-weight="600">${escapeXml(truncate(title, Math.max(12, Math.floor(contentWidth / (titleSize / 2)))))}</text>
  ${hasSubtitle ? `<text x="${contentX}" y="${subtitleY}" fill="${palette.secondary}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${subtitleSize}">${escapeXml(truncate(subtitle, Math.max(16, Math.floor(contentWidth / (subtitleSize / 2)))))}</text>` : ""}
  ${visibility.progress ? `<rect x="${contentX}" y="${progressY}" width="${contentWidth}" height="${progressHeight}" rx="${progressHeight / 2}" fill="${palette.track}"/><rect x="${contentX}" y="${progressY}" width="${progress}" height="${progressHeight}" rx="${progressHeight / 2}" fill="${palette.accent}"/>` : ""}
</svg>`;
}

function bounded(value, fallback, min, max, path) { const resolved = value ?? fallback; if (!Number.isInteger(resolved) || resolved < min || resolved > max) throw new RangeError(`${path}: expected an integer from ${min} to ${max}`); return resolved; }
function progressWidth(presence, available) { if (!presence.durationMs || presence.positionMs == null) return 0; return Math.round(available * Math.min(1, presence.positionMs / presence.durationMs)); }
function providerLabel(kind) { return kind === "track" ? "Music" : kind === "movie" ? "Movie" : kind === "episode" ? "Episode" : "Media"; }
function truncate(value, length) { return value.length > length ? `${value.slice(0, length - 1)}…` : value; }
function escapeXml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]); }
