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

export function renderCard(presence, options = {}) {
  const theme = options.theme ?? "midnight-blue";
  const palette = resolveCardTheme(theme, options.colors);
  const visibility = { ...SHOW_DEFAULTS, ...(theme === "compact" ? COMPACT_SHOW : {}), ...options.show };
  const artworkDataUri = options.artworkDataUri;
  if (artworkDataUri != null && (typeof artworkDataUri !== "string" || !DATA_IMAGE_PATTERN.test(artworkDataUri))) {
    throw new TypeError("artworkDataUri must be a validated raster data URI");
  }
  const hasArtwork = visibility.artwork && Boolean(artworkDataUri);
  const width = 480;
  const height = theme === "compact" ? 104 : hasArtwork ? 148 : 128;
  const contentX = hasArtwork ? 116 : 24;
  const contentWidth = width - contentX - 24;
  const progressY = height - 24;
  const progress = progressWidth(presence, contentWidth);
  const state = escapeXml(String(presence.state).toUpperCase());
  const kind = escapeXml(providerLabel(presence.kind));
  const title = escapeXml(truncate(presence.title, hasArtwork ? 36 : 48));
  const subtitle = presence.subtitle ? escapeXml(truncate(presence.subtitle, hasArtwork ? 42 : 56)) : "";
  const ariaSubtitle = presence.subtitle ? `, ${escapeXml(presence.subtitle)}` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-labelledby="title desc">
  <title id="title">Now playing: ${title}</title>
  <desc id="desc">${kind}${ariaSubtitle}</desc>
  <rect width="100%" height="100%" rx="10" fill="${palette.background}" stroke="${palette.border}"/>
  ${hasArtwork ? `<defs><clipPath id="art"><rect x="24" y="24" width="68" height="100" rx="7"/></clipPath></defs><image href="${artworkDataUri}" x="24" y="24" width="68" height="100" preserveAspectRatio="xMidYMid slice" clip-path="url(#art)"/>` : ""}
  ${visibility.state ? `<text x="${contentX}" y="30" font-family="system-ui,sans-serif" font-size="11" font-weight="700" letter-spacing="1.2" fill="${palette.accent}">${state}</text>` : ""}
  <text x="${contentX}" y="64" font-family="system-ui,sans-serif" font-size="21" font-weight="700" fill="${palette.primary}">${title}</text>
  ${visibility.subtitle && subtitle ? `<text x="${contentX}" y="86" font-family="system-ui,sans-serif" font-size="14" fill="${palette.secondary}">${subtitle}</text>` : ""}
  ${visibility.mediaType ? `<text x="${width - 24}" y="30" text-anchor="end" font-family="system-ui,sans-serif" font-size="11" fill="${palette.secondary}">${kind}</text>` : ""}
  ${visibility.progress ? `<rect x="${contentX}" y="${progressY}" width="${contentWidth}" height="4" rx="2" fill="${palette.track}"/><rect x="${contentX}" y="${progressY}" width="${progress}" height="4" rx="2" fill="${palette.accent}"/>` : ""}
</svg>`;
}

function progressWidth(presence, available) {
  if (!presence.durationMs || presence.positionMs == null) return 0;
  return Math.round(available * Math.min(1, presence.positionMs / presence.durationMs));
}
function providerLabel(kind) { return kind === "track" ? "Music" : kind === "movie" ? "Movie" : kind === "episode" ? "Episode" : "Media"; }
function truncate(value, length) { return value.length > length ? `${value.slice(0, length - 1)}…` : value; }
function escapeXml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]); }
