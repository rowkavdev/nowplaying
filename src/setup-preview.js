import { renderCard } from "./card.js";

// Example cards for the setup wizard (#143): one song, one TV episode and one
// film, drawn by the real card renderer so people see what their card will
// look like before anything is playing. Made-up examples only; nothing here
// comes from the user's servers.
export const PREVIEW_EXAMPLES = Object.freeze({
  music: Object.freeze({ label: "Music", presence: Object.freeze({ state: "playing", kind: "track", title: "Blue Monday", subtitle: "New Order", positionMs: 83_000, durationMs: 448_000 }) }),
  episode: Object.freeze({ label: "TV episode", presence: Object.freeze({ state: "playing", kind: "episode", title: "The Constant", subtitle: "Lost", series: "Lost", season: 4, episode: 5, positionMs: 1_200_000, durationMs: 2_580_000 }) }),
  film: Object.freeze({ label: "Film", presence: Object.freeze({ state: "playing", kind: "movie", title: "Dune: Part Two", subtitle: "2024", year: 2024, positionMs: 3_000_000, durationMs: 9_960_000 }) }),
});

// Plain grey square where the artwork goes, as on the settings page preview.
const ARTWORK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPo6p8BAANYAbKMazHIAAAAAElFTkSuQmCC";
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
    let body;
    try { body = renderCard(PREVIEW_EXAMPLES[match[1]].presence, { ...options, artworkDataUri: ARTWORK }); }
    catch { body = renderCard(PREVIEW_EXAMPLES[match[1]].presence, { artworkDataUri: ARTWORK }); }
    return Object.freeze({ status: 200, headers: Object.freeze({ "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" }), body });
  };
}

function text(status, message, extra = {}) {
  return Object.freeze({ status, headers: Object.freeze({ "Content-Type": "text/plain; charset=utf-8", ...extra }), body: message });
}
