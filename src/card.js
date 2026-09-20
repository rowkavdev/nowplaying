const COLORS = Object.freeze({
  background: "#0d1117",
  border: "#30363d",
  primary: "#f0f6fc",
  secondary: "#8b949e",
  accent: "#58a6ff",
});

const SHOW_DEFAULTS = Object.freeze({
  mediaType: true,
  progress: true,
  state: true,
  subtitle: true,
});

export function renderCard(presence, { width = 440, show = {} } = {}) {
  if (!Number.isInteger(width) || width < 280 || width > 800) throw new RangeError("width must be an integer from 280 to 800");
  if (show === null || typeof show !== "object" || Array.isArray(show)) throw new TypeError("show must be an object");
  const visibility = { ...SHOW_DEFAULTS, ...show };
  for (const [key, value] of Object.entries(visibility)) {
    if (!Object.hasOwn(SHOW_DEFAULTS, key)) throw new TypeError(`Unknown card visibility setting: ${key}`);
    if (typeof value !== "boolean") throw new TypeError(`card.show.${key} must be a boolean`);
  }

  const status = presence.state === "playing" ? "NOW PLAYING" : presence.state === "paused" ? "PAUSED" : "NOT PLAYING";
  const title = presence.title || "Nothing playing";
  const subtitle = presence.subtitle || (visibility.mediaType ? providerLabel(presence.kind) : "");
  const hasSubtitle = visibility.subtitle && subtitle;
  const height = 74 + (visibility.state ? 28 : 0) + (hasSubtitle ? 24 : 0) + (visibility.progress ? 6 : 0);
  const titleY = visibility.state ? 64 : 36;
  const subtitleY = titleY + 24;
  const progressY = height - 24;
  const progress = progressWidth(presence, width - 48);
  const description = subtitle || status;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(status)}: ${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(description)}</desc>
  <rect width="100%" height="100%" rx="10" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  ${visibility.state ? `<text x="24" y="30" fill="${COLORS.accent}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" font-weight="700" letter-spacing="1.4">${status}</text>` : ""}
  <text x="24" y="${titleY}" fill="${COLORS.primary}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="20" font-weight="600">${escapeXml(truncate(title, 38))}</text>
  ${hasSubtitle ? `<text x="24" y="${subtitleY}" fill="${COLORS.secondary}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="14">${escapeXml(truncate(subtitle, 52))}</text>` : ""}
  ${visibility.progress ? `<rect x="24" y="${progressY}" width="${width - 48}" height="4" rx="2" fill="${COLORS.border}"/>
  <rect x="24" y="${progressY}" width="${progress}" height="4" rx="2" fill="${COLORS.accent}"/>` : ""}
</svg>`;
}

function progressWidth(presence, available) {
  if (!presence.durationMs || presence.positionMs == null) return 0;
  return Math.round(available * Math.min(1, presence.positionMs / presence.durationMs));
}

function providerLabel(kind) {
  return kind === "track" ? "Music" : kind === "movie" ? "Movie" : kind === "episode" ? "Episode" : "Media";
}

function truncate(value, length) { return value.length > length ? `${value.slice(0, length - 1)}…` : value; }
function escapeXml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]); }
