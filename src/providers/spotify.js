import { defineProvider } from "../provider.js";

// Spotify provider (#135), first slice: reads what the signed-in user is
// playing from the Web API and maps it into the presence model. Sign-in
// (PKCE) and token refresh come in a later slice; this module only asks for a
// current access token through getAccessToken(), so it never sees a refresh
// token or client secret.
//
// Spotify only reports music and podcasts. Podcast episodes are reported as
// "track" (Listening) with the show as the subtitle, so they are never shown
// as TV. Ads and unknown items count as nothing playing.

const ENDPOINT = "https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode";

export function createSpotifyProvider({ getAccessToken, fetchImpl = fetch } = {}) {
  if (typeof getAccessToken !== "function") throw new TypeError("Spotify getAccessToken is required");

  return defineProvider({
    id: "spotify",
    mediaKinds: ["track"],
    async getPresence() {
      const token = await getAccessToken();
      if (typeof token !== "string" || !token) throw new Error("Spotify request failed: 401 (not signed in)");
      const response = await fetchImpl(ENDPOINT, { headers: { Authorization: `Bearer ${token}` } });
      // 204: nothing is playing, or a private session.
      if (response.status === 204) return { state: "idle" };
      if (!response.ok) {
        const error = new Error(`Spotify now-playing request failed: ${response.status}`);
        if (response.status === 429) {
          const seconds = Number(response.headers?.get?.("retry-after"));
          if (Number.isFinite(seconds) && seconds >= 0) error.retryAfterMs = seconds * 1000;
        }
        throw error;
      }
      return mapPlayback(await response.json());
    },
  });
}

export function mapPlayback(payload) {
  const item = payload?.item;
  const type = payload?.currently_playing_type;
  if (!item || (type !== "track" && type !== "episode")) return { state: "idle" };
  const title = text(item.name);
  if (!title) return { state: "idle" };
  const subtitle = type === "track"
    ? (Array.isArray(item.artists) ? item.artists.map((a) => text(a?.name)).filter(Boolean).join(", ") : null) || text(item.album?.name)
    : text(item.show?.name);
  const images = type === "track" ? item.album?.images : (item.images ?? item.show?.images);
  const durationMs = count(item.duration_ms);
  let positionMs = count(payload.progress_ms);
  if (positionMs !== null && durationMs !== null && positionMs > durationMs) positionMs = durationMs;
  return {
    state: payload.is_playing ? "playing" : "paused",
    kind: "track",
    title,
    subtitle: subtitle || null,
    artwork: null,
    artworkUrl: largestImage(images),
    positionMs,
    durationMs,
  };
}

function largestImage(images) {
  if (!Array.isArray(images)) return null;
  const usable = images.filter((image) => typeof image?.url === "string" && image.url.startsWith("https://"));
  usable.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return usable[0]?.url ?? null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}
