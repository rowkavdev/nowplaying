const COLORS = Object.freeze({
  background: "#0d1117",
  border: "#30363d",
  primary: "#f0f6fc",
  secondary: "#8b949e",
  accent: "#58a6ff",
});

export function renderCard(presence, { width = 440 } = {}) {
  if (!Number.isInteger(width) || width < 280 || width > 800) throw new RangeError("width must be an integer from 280 to 800");
  const status = presence.state === "playing" ? "NOW PLAYING" : presence.state === "paused" ? "PAUSED" : "NOT PLAYING";
  const title = presence.title || "Nothing playing";
  const subtitle = presence.subtitle || providerLabel(presence.kind);
  const progress = progressWidth(presence, width - 48);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="132" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(status)}: ${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(subtitle)}</desc>
  <rect width="100%" height="100%" rx="10" fill="${COLORS.background}" stroke="${COLORS.border}"/>
  <text x="24" y="30" fill="${COLORS.accent}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" font-weight="700" letter-spacing="1.4">${status}</text>
  <text x="24" y="64" fill="${COLORS.primary}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="20" font-weight="600">${escapeXml(truncate(title, 38))}</text>
  <text x="24" y="88" fill="${COLORS.secondary}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="14">${escapeXml(truncate(subtitle, 52))}</text>
  <rect x="24" y="108" width="${width - 48}" height="4" rx="2" fill="${COLORS.border}"/>
  <rect x="24" y="108" width="${progress}" height="4" rx="2" fill="${COLORS.accent}"/>
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
