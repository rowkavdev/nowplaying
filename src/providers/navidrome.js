import { defineProvider } from "../provider.js";

export function createNavidromeProvider({ baseUrl, username, token, salt, fetchImpl = fetch }) {
  const origin = normalizeBaseUrl(baseUrl);
  for (const [name, value] of Object.entries({ username, token, salt })) {
    if (typeof value !== "string" || !value.trim()) throw new TypeError(`Navidrome ${name} is required`);
  }
  const auth = new URLSearchParams({ u: username, t: token, s: salt, v: "1.16.1", c: "nowplaying", f: "json" });

  return defineProvider({
    id: "navidrome",
    async getPresence({ username: playingUser } = {}) {
      const response = await fetchImpl(`${origin}/rest/getNowPlaying.view?${auth}`);
      if (!response.ok) throw new Error(`Navidrome now-playing request failed: ${response.status} ${response.statusText}`);
      const payload = await response.json();
      const root = payload["subsonic-response"];
      if (root?.status === "failed") throw new Error(`Navidrome API error: ${root.error?.message || "unknown error"}`);
      const entries = root?.nowPlaying?.entry ?? [];
      const entry = entries.find((item) => !playingUser || item.username?.localeCompare(playingUser, undefined, { sensitivity: "accent" }) === 0);
      return entry ? mapEntry(entry) : { state: "idle" };
    },
  });
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Navidrome baseUrl is required");
  return new URL(value).toString().replace(/\/$/, "");
}

function mapEntry(entry) {
  return {
    state: "playing", kind: "track", title: entry.title, subtitle: entry.artist || entry.album,
    artwork: entry.coverArt ? { provider: "navidrome", imageId: entry.coverArt, type: "cover" } : null,
    artworkUrl: null,
    positionMs: null,
    durationMs: Number.isFinite(entry.duration) ? entry.duration * 1000 : null,
  };
}
