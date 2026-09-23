import { defineProvider } from "../provider.js";

const TICKS_PER_MILLISECOND = 10_000;

export function createJellyfinProvider({ baseUrl, apiKey, fetchImpl = fetch }) {
  const origin = normalizeBaseUrl(baseUrl);
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new TypeError("Jellyfin apiKey is required");
  return defineProvider({
    id: "jellyfin",
    async getPresence({ username } = {}) {
      const response = await fetchImpl(`${origin}/Sessions`, { headers: { Accept: "application/json", "X-Emby-Token": apiKey } });
      if (!response.ok) throw new Error(`Jellyfin sessions request failed: ${response.status} ${response.statusText}`);
      const sessions = await response.json();
      const session = sessions.find((candidate) => matchesSession(candidate, username));
      return session ? mapSession(session) : { state: "idle" };
    },
    async whoami() {
      const response = await fetchImpl(`${origin}/Users/Me`, { headers: { Accept: "application/json", "X-Emby-Token": apiKey } });
      if (!response.ok) throw new Error(`Jellyfin user request failed: ${response.status} ${response.statusText}`);
      const user = await response.json();
      return { id: typeof user?.Id === "string" ? user.Id : null, displayName: typeof user?.Name === "string" ? user.Name : null };
    },
  });
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Jellyfin baseUrl is required");
  return new URL(value).toString().replace(/\/$/, "");
}

function matchesSession(session, username) {
  if (!session?.NowPlayingItem) return false;
  if (!username) return true;
  return session.UserName?.localeCompare(username, undefined, { sensitivity: "accent" }) === 0;
}

function mapSession(session) {
  const item = session.NowPlayingItem;
  const kind = item.Type === "Audio" ? "track" : item.Type === "Episode" ? "episode" : item.Type === "Movie" ? "movie" : "unknown";
  const subtitle = kind === "episode" ? item.SeriesName || item.SeasonName : kind === "track" ? item.Artists?.join(", ") || item.AlbumArtist : item.ProductionYear ? String(item.ProductionYear) : null;
  const imageTag = item.ImageTags?.Primary;
  return {
    state: session.PlayState?.IsPaused ? "paused" : "playing", kind, title: item.Name, subtitle,
    artwork: imageTag ? { provider: "jellyfin", itemId: item.Id, imageTag, type: "primary" } : null,
    artworkUrl: null,
    positionMs: ticksToMilliseconds(session.PlayState?.PositionTicks), durationMs: ticksToMilliseconds(item.RunTimeTicks),
  };
}

function ticksToMilliseconds(value) { return value == null ? null : Math.floor(value / TICKS_PER_MILLISECOND); }
