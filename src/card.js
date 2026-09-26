export const cardThemes = Object.freeze({
  "midnight-blue": Object.freeze({ background: "#0d1117", border: "#30363d", primary: "#f0f6fc", secondary: "#9aa7b7", accent: "#58a6ff", track: "#30363d" }),
  paper: Object.freeze({ background: "#ffffff", border: "#c7d2df", primary: "#172033", secondary: "#526173", accent: "#0969da", track: "#d8e0e8" }),
  compact: Object.freeze({ background: "#0d1117", border: "#30363d", primary: "#f0f6fc", secondary: "#9aa7b7", accent: "#58a6ff", track: "#30363d" }),
});


const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const DEFAULT_FIELD_ORDER = Object.freeze(["state", "title", "subtitle"]);
const TEXT_ANCHORS = Object.freeze({ start: "start", middle: "middle", end: "end" });
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


export function renderCard(presence, { width = 440, show = {}, theme = "midnight-blue", colors = {}, artworkDataUri = null, layout = {}, tint = null } = {}) {
  if (!Number.isInteger(width) || width < 280 || width > 800) throw new RangeError("width must be an integer from 280 to 800");
  if (show === null || typeof show !== "object" || Array.isArray(show)) throw new TypeError("show must be an object");
  if (layout === null || typeof layout !== "object" || Array.isArray(layout)) throw new TypeError("layout must be an object");
  const allowedLayout = new Set(["padding", "radius", "titleSize", "subtitleSize", "progressHeight", "artworkPosition", "artworkWidth", "artworkHeight", "fieldOrder", "textAlign", "progressPosition", "progressWidth", "direction"]);
  for (const key of Object.keys(layout)) if (!allowedLayout.has(key)) throw new TypeError(`Unknown card layout setting: ${key}`);
  const padding = bounded(layout.padding, 24, 12, 48, "layout.padding");
  const radius = bounded(layout.radius, 10, 0, 24, "layout.radius");
  const titleSize = bounded(layout.titleSize, 20, 14, 30, "layout.titleSize");
  const subtitleSize = bounded(layout.subtitleSize, 14, 10, 20, "layout.subtitleSize");
  const progressHeight = bounded(layout.progressHeight, 4, 2, 12, "layout.progressHeight");
  const directionSetting = layout.direction ?? "ltr";
  if (!new Set(["ltr", "rtl", "auto"]).has(directionSetting)) throw new TypeError("layout.direction: expected ltr, rtl or auto");
  const presetShow = theme === "compact" ? COMPACT_SHOW : {};
  const visibility = { ...SHOW_DEFAULTS, ...presetShow, ...show };
  for (const [key, value] of Object.entries(visibility)) {
    if (!Object.hasOwn(SHOW_DEFAULTS, key)) throw new TypeError(`Unknown card visibility setting: ${key}`);
    if (typeof value !== "boolean") throw new TypeError(`card.show.${key} must be a boolean`);
  }
  // Hidden subtitle must not influence markup or the automatic text direction.
  const rtl = directionSetting === "rtl" || (directionSetting === "auto" && firstStrongIsRtl(`${presence.title ?? ""}${visibility.subtitle ? presence.subtitle ?? "" : ""}`));
  const artworkPosition = layout.artworkPosition ?? (rtl ? "right" : "left");
  if (!new Set(["left", "right"]).has(artworkPosition)) throw new TypeError("layout.artworkPosition: expected left or right");
  // Album art is square; posters and episode stills keep the 2:3 shape.
  const requestedArtworkWidth = bounded(layout.artworkWidth, presence.kind === "track" ? 100 : 68, 48, 160, "layout.artworkWidth");
  const artworkHeight = bounded(layout.artworkHeight, 100, 48, 180, "layout.artworkHeight");
  const fieldOrder = layout.fieldOrder ?? DEFAULT_FIELD_ORDER;
  if (!Array.isArray(fieldOrder) || fieldOrder.length !== 3 || new Set(fieldOrder).size !== 3 || !fieldOrder.every((field) => DEFAULT_FIELD_ORDER.includes(field))) throw new TypeError("layout.fieldOrder: expected state, title and subtitle, each once");
  const progressPosition = layout.progressPosition ?? "bottom";
  if (!new Set(["bottom", "text"]).has(progressPosition)) throw new TypeError("layout.progressPosition: expected bottom or text");
  const progressSpan = layout.progressWidth ?? "content";
  if (!new Set(["content", "full"]).has(progressSpan)) throw new TypeError("layout.progressWidth: expected content or full");
  const textAlign = layout.textAlign ?? "start";
  if (!Object.hasOwn(TEXT_ANCHORS, textAlign)) throw new TypeError("layout.textAlign: expected start, middle or end");
  if (artworkDataUri !== null && (typeof artworkDataUri !== "string" || !DATA_IMAGE_PATTERN.test(artworkDataUri))) throw new TypeError("artworkDataUri must be a validated raster data URI");
  // Privacy removes both timing fields before rendering. Do not leave an
  // empty bar when the user hid progress (or the source has no timing).
  if (presence.state === "playing" || presence.state === "paused") {
    visibility.progress &&= presence.durationMs > 0 && Number.isFinite(presence.positionMs);
  }
  const palette = resolveCardTheme(theme, colors);
  if (tint !== null && (typeof tint !== "string" || !COLOR_PATTERN.test(tint))) throw new TypeError("tint must be a six-digit hex color");
  const hasArtwork = visibility.artwork && artworkDataUri !== null;
  // Give titles room at the narrowest card width even when both padding and
  // artwork are set to their individual maximums. Keep the saved preference;
  // only the artwork rendered at this width is scaled down.
  const artworkWidth = hasArtwork ? Math.min(requestedArtworkWidth, width - padding * 2 - 24 - 100) : requestedArtworkWidth;
  const artworkX = artworkPosition === "right" ? width - padding - artworkWidth : padding;
  const contentX = hasArtwork && artworkPosition === "left" ? padding + artworkWidth + 24 : padding;
  const contentWidth = width - contentX - padding - (hasArtwork && artworkPosition === "right" ? artworkWidth + 24 : 0);
  const status = presence.state === "playing" ? "NOW PLAYING" : presence.state === "paused" ? "PAUSED" : "NOT PLAYING";
  const text = cardText(presence);
  const title = text.title || "Nothing playing";
  const subtitle = text.subtitle || (visibility.mediaType ? providerLabel(presence.kind) : "");
  const hasSubtitle = visibility.subtitle && subtitle;
  const baseHeight = Math.max(hasArtwork ? padding * 2 + artworkHeight : 74, padding * 2 + titleSize + (visibility.state ? 22 : 0) + (hasSubtitle ? subtitleSize + 10 : 0) + (visibility.progress ? progressHeight + 16 : 0));
  // Text lines stack in fieldOrder. The default order gives the same
  // positions and height as before fieldOrder existed.
  const lines = fieldOrder.filter((field) => field === "title" || (field === "state" ? visibility.state : hasSubtitle));
  const sizes = { state: 11, title: titleSize, subtitle: subtitleSize };
  const baselines = {};
  let cursor = null;
  let previous = null;
  for (const field of lines) {
    cursor = cursor === null ? padding + (field === "state" ? 6 : sizes[field]) : cursor + (previous === "state" && field === "title" ? 34 : sizes[field] + (previous === "state" ? 14 : 10));
    baselines[field] = cursor;
    previous = field;
  }
  const customOrder = fieldOrder.some((field, index) => field !== DEFAULT_FIELD_ORDER[index]);
  const underArtwork = progressSpan === "full" && hasArtwork && visibility.progress ? padding * 2 + artworkHeight + 12 + progressHeight : 0;
  const height = Math.max(baseHeight, customOrder ? cursor + padding + 2 + (visibility.progress ? progressHeight + 16 : 0) : 0, underArtwork);
  const titleY = baselines.title;
  const subtitleY = baselines.subtitle;
  const stateY = baselines.state;
  // In RTL, start is the right edge. SVG text-anchor is relative to the
  // text direction too, so direction="rtl" with anchor start sits on x as
  // its right end.
  const edge = textAlign === "middle" ? "middle" : (textAlign === "start") !== rtl ? "left" : "right";
  const textX = edge === "middle" ? contentX + Math.round(contentWidth / 2) : edge === "right" ? contentX + contentWidth : contentX;
  const anchor = edge === "middle" ? "middle" : (edge === "right") === rtl ? "start" : "end";
  const anchorAttr = (anchor === "start" ? "" : ` text-anchor="${anchor}"`) + (rtl ? ' direction="rtl"' : "");
  // "text" puts the bar under the last line instead of the card's bottom
  // edge; "full" runs it across the whole card, under the artwork too.
  const progressY = progressPosition === "text" && !underArtwork ? Math.min(height - padding, cursor + 16) : height - padding;
  const barX = progressSpan === "full" ? padding : contentX;
  const barWidth = progressSpan === "full" ? width - padding * 2 : contentWidth;
  const progress = progressWidth(presence, barWidth);
  const description = hasSubtitle ? subtitle : status;
  // Elapsed / total sits across from the status line when the layout is the
  // plain default, so it never collides with reordered or centred text.
  // It's left out when the two wouldn't both fit (narrow cards, long films).
  const dot = visibility.state && presence.state === "playing" && edge !== "middle";
  const timeCandidate = presence.durationMs > 0 && Number.isFinite(presence.positionMs) ? `${clock(Math.min(Math.max(0, presence.positionMs), presence.durationMs))} / ${clock(presence.durationMs)}` : "";
  const timeFits = (dot ? 14 : 0) + estimateWidth(status, 11, 0.64, 1.1) + 16 + estimateWidth(timeCandidate, 11, 0.6, 0) <= contentWidth;
  const showTime = Boolean(timeCandidate) && timeFits && visibility.progress && visibility.state && !customOrder && textAlign === "start";
  const timeX = rtl ? contentX : contentX + contentWidth;
  const timeAnchor = rtl ? "start" : "end";
  const timeLabel = showTime ? timeCandidate : "";
  const dotX = edge === "right" ? textX - 4 : textX + 4;
  const stateX = dot ? (edge === "right" ? textX - 14 : textX + 14) : textX;
  const light = luminance(palette.background) > 0.5;
  // Any tint is pulled into a safe lightness range first, so a white or black
  // cover can't wash out the text.
  const tintStop = tint ? mix(palette.background, clampLightness(tint, light ? 0.6 : 0.12, light ? 0.9 : 0.45), light ? 0.12 : 0.34) : null;
  const background = tintStop ? "url(#bg)" : palette.background;
  const defs = [
    tintStop ? `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tintStop}"/><stop offset="0.75" stop-color="${palette.background}"/></linearGradient>` : "",
    `<clipPath id="txt"><rect x="${contentX - 2}" y="0" width="${contentWidth + 4}" height="${height}"/></clipPath>`,
    hasArtwork ? `<clipPath id="art"><rect x="${artworkX}" y="${padding}" width="${artworkWidth}" height="${artworkHeight}" rx="${Math.min(radius, 8)}"/></clipPath>` : "",
  ].join("");
  const font = 'font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif"';


  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(status)}: ${escapeXml(title)}</title><desc id="desc">${escapeXml(description)}</desc>
  ${defs ? `<defs>${defs}</defs>` : ""}
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${radius}" fill="${background}" stroke="${palette.border}"/>
  ${hasArtwork ? `<image href="${artworkDataUri}" x="${artworkX}" y="${padding}" width="${artworkWidth}" height="${artworkHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#art)"/><rect x="${artworkX + 0.5}" y="${padding + 0.5}" width="${artworkWidth - 1}" height="${artworkHeight - 1}" rx="${Math.min(radius, 8)}" fill="none" stroke="${light ? "#000000" : "#ffffff"}" stroke-opacity="0.12"/>` : ""}
  ${dot ? `<circle cx="${dotX}" cy="${stateY - 4}" r="3.5" fill="${palette.accent}"/>` : ""}
  ${visibility.state ? `<text x="${stateX}" y="${stateY}"${anchorAttr} fill="${palette.accent}" ${font} font-size="11" font-weight="700" letter-spacing="1.1">${status}</text>` : ""}
  ${showTime ? `<text x="${timeX}" y="${stateY}" text-anchor="${timeAnchor}" fill="${palette.secondary}" ${font} font-size="11" font-variant-numeric="tabular-nums">${timeLabel}</text>` : ""}
  <text x="${textX}" y="${titleY}"${anchorAttr} fill="${palette.primary}" ${font} font-size="${titleSize}" font-weight="700" letter-spacing="-0.2" clip-path="url(#txt)">${escapeXml(truncate(title, Math.max(4, Math.floor(contentWidth / (titleSize * 0.64)))))}</text>
  ${hasSubtitle ? `<text x="${textX}" y="${subtitleY}"${anchorAttr} fill="${palette.secondary}" ${font} font-size="${subtitleSize}" font-weight="500" clip-path="url(#txt)">${escapeXml(truncate(subtitle, Math.max(4, Math.floor(contentWidth / (subtitleSize * 0.55)))))}</text>` : ""}
  ${visibility.progress ? `<rect x="${barX}" y="${progressY}" width="${barWidth}" height="${progressHeight}" rx="${progressHeight / 2}" fill="${palette.track}"/><rect x="${rtl ? barX + barWidth - progress : barX}" y="${progressY}" width="${progress}" height="${progressHeight}" rx="${progressHeight / 2}" fill="${palette.accent}"/>` : ""}
</svg>`;
}


function bounded(value, fallback, min, max, path) { const resolved = value ?? fallback; if (!Number.isInteger(resolved) || resolved < min || resolved > max) throw new RangeError(`${path}: expected an integer from ${min} to ${max}`); return resolved; }
function progressWidth(presence, available) { if (!(presence.durationMs > 0) || !Number.isFinite(presence.positionMs)) return 0; return Math.round(available * Math.min(1, Math.max(0, presence.positionMs / presence.durationMs))); }
// TV and films (#143): an episode reads "Show Name" / "S02E05 · Episode
// Title", a film "Film Title (2024)". Anything missing (or hidden by the
// privacy settings) falls back to the provider's plain title and subtitle.
export function cardText(presence) {
  if (presence.kind === "episode" && presence.series) {
    const season = presence.season ?? null;
    const episode = presence.episode ?? null;
    const code = season !== null && episode !== null ? `S${pad(season)}E${pad(episode)}` : episode !== null ? `E${pad(episode)}` : season !== null ? `Season ${season}` : null;
    const name = presence.title && presence.title !== presence.series ? presence.title : null;
    return { title: presence.series, subtitle: [code, name].filter(Boolean).join(" · ") || null };
  }
  if (presence.kind === "movie" && presence.title && presence.year) {
    const year = String(presence.year);
    const title = presence.title.endsWith(`(${year})`) ? presence.title : `${presence.title} (${year})`;
    return { title, subtitle: presence.subtitle === year ? null : presence.subtitle || null };
  }
  return { title: presence.title || null, subtitle: presence.subtitle || null };
}
// Rough width of a line of text: size x per-character factor, plus spacing.
// Generous on purpose so the check fails safe.
function estimateWidth(text, size, factor, spacing) { return text.length * (size * factor + spacing); }
function clock(ms) { const total = Math.floor(ms / 1000); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const sec = pad(total % 60); return h ? `${h}:${pad(m)}:${sec}` : `${m}:${sec}`; }
function clampLightness(hex, min, max) {
  const [r, g, b] = channels(hex).map((v) => v / 255);
  const high = Math.max(r, g, b); const low = Math.min(r, g, b);
  const lightness = (high + low) / 2;
  const target = Math.min(max, Math.max(min, lightness));
  if (target === lightness) return hex;
  const saturation = high === low ? 0 : (high - low) / (1 - Math.abs(2 * lightness - 1));
  const hue = high === low ? 0 : high === r ? ((g - b) / (high - low) + 6) % 6 : high === g ? (b - r) / (high - low) + 2 : (r - g) / (high - low) + 4;
  const chroma = (1 - Math.abs(2 * target - 1)) * saturation;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const [r1, g1, b1] = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const m = target - chroma / 2;
  return `#${[r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
function channels(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }
function luminance(hex) { const [r, g, b] = channels(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
function mix(from, to, amount) { const a = channels(from); const b = channels(to); return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`; }
function pad(value) { return String(value).padStart(2, "0"); }
function providerLabel(kind) { return kind === "track" ? "Music" : kind === "movie" ? "Movie" : kind === "episode" ? "Episode" : "Media"; }
function truncate(value, length) { return value.length > length ? `${value.slice(0, length - 1)}…` : value; }
// Control characters (ID3 tags often end in NUL), U+FFFE/U+FFFF and lone
// surrogates are not allowed anywhere in XML 1.0, even escaped, and one of
// them makes the whole SVG fail to load. Drop them before escaping.
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function escapeXml(value) { return String(value).replace(XML_INVALID, "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]); }
// Hebrew, Arabic, Syriac, Thaana, NKo and related blocks, plus RTL
// presentation forms. Latin, digits and punctuation are skipped over.
function firstStrongIsRtl(text) {
  for (const char of text) {
    if (/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(char)) return true;
    if (/\p{L}/u.test(char)) return false;
  }
  return false;
}
