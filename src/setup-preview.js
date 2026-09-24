import { renderCard } from "./card.js";

// Example cards for the setup wizard (#143): one song, one TV episode and one
// film, drawn by the real card renderer so people see what their card will
// look like before anything is playing. Made-up examples only; nothing here
// comes from the user's servers.
export const PREVIEW_EXAMPLES = Object.freeze({
  music: Object.freeze({ label: "Music", presence: Object.freeze({ state: "playing", kind: "track", title: "Blue Monday", subtitle: "New Order", positionMs: 83_000, durationMs: 448_000 }) }),
  episode: Object.freeze({ label: "TV episode", presence: Object.freeze({ state: "playing", kind: "episode", title: "The Constant", subtitle: "Lost", series: "Lost", season: 4, episode: 5, positionMs: 1_200_000, durationMs: 2_580_000 }) }),
  film: Object.freeze({ label: "Film", presence: Object.freeze({ state: "playing", kind: "movie", title: "Dune: Part Two", subtitle: "Denis Villeneuve", year: 2024, positionMs: 3_000_000, durationMs: 9_960_000 }) }),
});

// Made-up artwork for each example, drawn once with sharp and cached. Simple
// poster-style shapes with a little grain, in the blue/orange palette, and a
// matching tint for the card background.
const ART = Object.freeze({
  music: { tint: "#1f3a8a", width: 200, height: 200, svg: `
    <rect width="200" height="200" fill="#1e40af"/>
    <circle cx="138" cy="100" r="84" fill="#0b0b10"/>
    ${[76, 68, 60, 52, 44].map((r) => `<circle cx="138" cy="100" r="${r}" fill="none" stroke="#262a3a" stroke-width="1.2"/>`).join("")}
    <circle cx="138" cy="100" r="24" fill="#f28c28"/>
    <circle cx="138" cy="100" r="3.5" fill="#0b0b10"/>
    <rect width="104" height="200" fill="#f28c28"/>
    <rect x="18" y="18" width="68" height="6" fill="#1e40af"/>
    <rect x="18" y="30" width="44" height="6" fill="#1e40af"/>` },
  episode: { tint: "#0e3a5c", width: 136, height: 200, svg: `
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07152b"/><stop offset="1" stop-color="#1d5b8f"/></linearGradient></defs>
    <rect width="136" height="200" fill="url(#sky)"/>
    <circle cx="68" cy="122" r="30" fill="#f59e42"/>
    <rect y="122" width="136" height="78" fill="#061021"/>
    ${[132, 144, 158, 174].map((y, i) => `<rect x="${34 - i * 6}" y="${y}" width="${68 + i * 12}" height="2" fill="#f59e42" opacity="${0.5 - i * 0.1}"/>`).join("")}` },
  film: { tint: "#7a3c10", width: 136, height: 200, svg: `
    <defs><linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a4a"/><stop offset="0.55" stop-color="#c2622a"/><stop offset="1" stop-color="#f2b26b"/></linearGradient></defs>
    <rect width="136" height="200" fill="url(#dusk)"/>
    <circle cx="96" cy="46" r="10" fill="#e8eefc"/>
    <path d="M0 132C30 118 64 120 136 140V200H0Z" fill="#b5541c"/>
    <path d="M0 158C44 142 90 150 136 164V200H0Z" fill="#7c3510"/>
    <path d="M0 182C50 170 96 176 136 188V200H0Z" fill="#4a1f0a"/>` },
});
const GRAIN = `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.07 0"/></filter>`;
const cache = new Map();

export async function previewArtwork(kind) {
  if (!cache.has(kind)) {
    const { width, height, svg } = ART[kind];
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${GRAIN}</defs>${svg}<rect width="${width}" height="${height}" filter="url(#grain)"/></svg>`;
    cache.set(kind, (async () => {
      const { default: sharp } = await import("sharp");
      const jpeg = await sharp(Buffer.from(source)).jpeg({ quality: 86 }).toBuffer();
      return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    })().catch((error) => { cache.delete(kind); throw error; }));
  }
  return cache.get(kind);
}

const PATH = /^\/api\/setup\/preview\/(music|episode|film)\.svg$/;

export function createSetupPreviewHandler({ renderOptions = async () => ({}) } = {}) {
  return async function handle(request = {}) {
    const url = new URL(request.url || "/", "http://localhost");
    const match = PATH.exec(url.pathname);
    if (!match) return null;
    if ((request.method || "GET") !== "GET") return text(405, "Method Not Allowed", { Allow: "GET" });
    if (url.search) return text(400, "Bad Request");
    let options = {};
    try { options = await renderOptions(); } catch { options = {}; }
    const kind = match[1];
    let artworkDataUri = null;
    try { artworkDataUri = await previewArtwork(kind); } catch { artworkDataUri = null; }
    const extras = { artworkDataUri, tint: ART[kind].tint };
    let body;
    try { body = renderCard(PREVIEW_EXAMPLES[kind].presence, { ...options, ...extras }); }
    catch { body = renderCard(PREVIEW_EXAMPLES[kind].presence, extras); }
    return Object.freeze({ status: 200, headers: Object.freeze({ "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" }), body });
  };
}

function text(status, message, extra = {}) {
  return Object.freeze({ status, headers: Object.freeze({ "Content-Type": "text/plain; charset=utf-8", ...extra }), body: message });
}
