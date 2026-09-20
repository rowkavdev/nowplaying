import { defineProvider } from "../provider.js";

const TICKS_PER_MILLISECOND = 10_000;

export function createEmbyProvider({ baseUrl, apiKey, fetchImpl = fetch }) {
  const origin = normalizeBaseUrl(baseUrl);
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new TypeError("Emby apiKey is required");
  return defineProvider({
    id: "emby",
    async getPresence({ username } = {}) {
      const response = await fetchImpl(`${origin}/Sessions`, { headers: { Accept: "application/json", "X-Emby-Token": apiKey } });
      if (!response.ok) throw new Error(`Emby sessions request failed: ${response.status} ${response.statusText}`);
      const sessions = await response.json();
      const session = sessions.find((candidate) => matchesSession(candidate, username));
      return session ? mapSession(session, origin, apiKey) : { state: "idle" };
    },
  });
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Emby baseUrl is required");
  return new URL(value).toString().replace(/\/$/, "");
}

function matchesSession(session, username) {
  if (!session?.NowPlayingItem) return false;
  if (!username) return true;
  return session.UserName?.localeCompare(username, undefined, { sensitivity: "accent" }) === 0;
}

function mapSession(session, origin, apiKey) {
  const item = session.NowPlayingItem;
  const kind = item.Type === "Audio" ? "track" : item.Type === "Episode" ? "episode" : item.Type === "Movie" ? "movie" : "unknown";
  const subtitle = kind === "episode" ? item.SeriesName || item.SeasonName : kind === "track" ? item.Artists?.join(", ") || item.AlbumArtist : item.ProductionYear ? String(item.ProductionYear) : null;
  const imageTag = item.ImageTags?.Primary;
  return {
    state: session.PlayState?.IsPaused ? "paused" : "playing", kind, title: item.Name, subtitle,
    artworkUrl: imageTag ? `${origin}/Items/${encodeURIComponent(item.Id)}/Images/Primary?tag=${encodeURIComponent(imageTag)}&api_key=${encodeURIComponent(apiKey)}` : null,
    positionMs: ticksToMilliseconds(session.PlayState?.PositionTicks), durationMs: ticksToMilliseconds(item.RunTimeTicks),
  };
}

function ticksToMilliseconds(value) { return value == null ? null : Math.floor(value / TICKS_PER_MILLISECOND); }
