// Opt-in artwork lookup for Discord presence (#124). Sends only the track
// title and artist to MusicBrainz, then points Discord at the Cover Art
// Archive front cover for the best-matching release. Follows the MusicBrainz
// API rules: an identifying User-Agent and at most one request per second.

const API = "https://musicbrainz.org/ws/2/recording";
const COVERS = "https://coverartarchive.org/release";
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MUSICBRAINZ_USER_AGENT = "nowplaying/0.2 ( https://github.com/rowkavdev/nowplaying )";

export function luceneTerm(value) {
  return `"${String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200).replace(/[\\"]/g, "\\$&")}"`;
}

export function createMusicBrainzLookup({ fetchImpl = globalThis.fetch, userAgent = MUSICBRAINZ_USER_AGENT, minIntervalMs = 1100, minScore = 90, timeoutMs = 5000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (typeof userAgent !== "string" || !/\(.+\)/.test(userAgent)) throw new TypeError("userAgent must include contact details in parentheses");
  let queue = Promise.resolve();
  let lastRequestAt = -Infinity;

  // Every outbound request (MusicBrainz and Cover Art Archive) goes through one
  // serial queue spaced by minIntervalMs.
  function limited(url, init) {
    const run = queue.then(async () => {
      const wait = lastRequestAt + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now();
      // The deadline covers reading the body too: clearing it once headers
      // arrive let a reply that stalls mid-body hang the lookup, and with it
      // Discord artwork for that track. Aborting a finished request is a no-op.
      const controller = new AbortController();
      setTimeout(() => controller.abort(), timeoutMs).unref?.();
      return fetchImpl(url, { ...init, signal: controller.signal, headers: { "User-Agent": userAgent, Accept: "application/json" } });
    });
    queue = run.catch(() => {});
    return run;
  }

  return async function lookup({ title, artist } = {}) {
    if (typeof title !== "string" || !title.trim()) return null;
    // A title on its own matches whichever song of that name scores highest,
    // which is usually someone else's. No artist means no guess (#154).
    if (typeof artist !== "string" || !artist.trim()) return null;
    const query = `recording:${luceneTerm(title)} AND artist:${luceneTerm(artist)}`;
    const response = await limited(`${API}?${new URLSearchParams({ query, fmt: "json", limit: "5" })}`, { redirect: "error" });
    if (!response.ok) return null;
    const body = await response.json();
    const releases = (Array.isArray(body?.recordings) ? body.recordings : [])
      .filter((recording) => Number(recording?.score) >= minScore)
      .flatMap((recording) => (Array.isArray(recording.releases) ? recording.releases : []))
      .map((release) => release?.id)
      .filter((id) => typeof id === "string" && MBID.test(id));
    for (const id of [...new Set(releases)].slice(0, 3)) {
      const cover = `${COVERS}/${id}/front-250`;
      const check = await limited(cover, { method: "HEAD", redirect: "manual" });
      if (check.status === 200 || (check.status >= 301 && check.status <= 308)) return cover;
    }
    return null;
  };
}
