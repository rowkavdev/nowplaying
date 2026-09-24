import { defineProvider } from "../provider.js";
import { optionalCount, optionalText, optionalYear } from "./fields.js";

const TICKS_PER_MILLISECOND = 10_000;

export function createEmbyProvider({ baseUrl, apiKey, fetchImpl = fetch }) {
  const origin = normalizeBaseUrl(baseUrl);
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new TypeError("Emby apiKey is required");
  return defineProvider({
    id: "emby",
    async getPresence({ username, userId } = {}) {
      const response = await fetchImpl(`${origin}/Sessions`, { headers: { Accept: "application/json", "X-Emby-Token": apiKey } });
      if (!response.ok) throw new Error(`Emby sessions request failed: ${response.status} ${response.statusText}`);
      const sessions = await response.json();
      const session = sessions.find((candidate) => matchesSession(candidate, { username, userId }));
      return session ? mapSession(session) : { state: "idle" };
    },
    async whoami() {
      const response = await fetchImpl(`${origin}/Users/Me`, { headers: { Accept: "application/json", "X-Emby-Token": apiKey } });
      if (!response.ok) throw new Error(`Emby user request failed: ${response.status} ${response.statusText}`);
      const user = await response.json();
      return { id: typeof user?.Id === "string" ? user.Id : null, displayName: typeof user?.Name === "string" ? user.Name : null };
    },
  });
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Emby baseUrl is required");
  return new URL(value).toString().replace(/\/$/, "");
}

// The stable user ID wins when we have one: display names can be renamed or
// shared by two people on the same server. The name is only a fallback for
// configs that predate stable identities.
function matchesSession(session, { username, userId } = {}) {
  if (!session?.NowPlayingItem) return false;
  if (userId) return sameUserId(session.UserId, userId);
  if (!username) return true;
  return session.UserName?.localeCompare(username, undefined, { sensitivity: "accent" }) === 0;
}

function sameUserId(actual, expected) {
  const normalize = (value) => typeof value === "string" ? value.replace(/-/g, "").toLowerCase() : "";
  const left = normalize(actual);
  return left !== "" && left === normalize(expected);
}

function mapSession(session) {
  const item = session.NowPlayingItem;
  const kind = item.Type === "Audio" ? "track" : item.Type === "Episode" ? "episode" : item.Type === "Movie" ? "movie" : "unknown";
  const subtitle = kind === "episode" ? item.SeriesName || item.SeasonName : kind === "track" ? item.Artists?.join(", ") || item.AlbumArtist : item.ProductionYear ? String(item.ProductionYear) : null;
  const imageTag = item.ImageTags?.Primary;
  return {
    state: session.PlayState?.IsPaused ? "paused" : "playing", kind, title: item.Name, subtitle,
    artwork: imageTag ? { provider: "emby", itemId: item.Id, imageTag, type: "primary" } : null,
    artworkUrl: null,
    positionMs: ticksToMilliseconds(session.PlayState?.PositionTicks), durationMs: ticksToMilliseconds(item.RunTimeTicks),
    // Episode and movie details (#143): ParentIndexNumber is the season,
    // IndexNumber the episode.
    series: kind === "episode" ? optionalText(item.SeriesName) : null,
    season: kind === "episode" ? optionalCount(item.ParentIndexNumber) : null,
    episode: kind === "episode" ? optionalCount(item.IndexNumber) : null,
    year: kind === "episode" || kind === "movie" ? optionalYear(item.ProductionYear) : null,
  };
}

function ticksToMilliseconds(value) { return value == null ? null : Math.floor(value / TICKS_PER_MILLISECOND); }
