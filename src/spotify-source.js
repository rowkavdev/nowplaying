import { createSpotifyTokenSource } from "./spotify-auth.js";
import { createSpotifyProvider } from "./providers/spotify.js";
import { withProviderBackoff } from "./provider-backoff.js";

// Runtime pieces for Spotify (#135).

// Builds the Spotify provider from config.spotify, reading and saving the
// refresh token through the credential store. Returns null when Spotify
// isn't set up. A Spotify problem never stops the app from starting; it just
// fails polls (with backoff) until the user signs in again.
export function createSpotifySource(config, credentialStore, { fetchImpl = fetch, backoff = {} } = {}) {
  const spotify = config?.spotify;
  if (!spotify) return null;
  if (typeof credentialStore?.read !== "function" || typeof credentialStore?.save !== "function") {
    throw new TypeError("credentialStore.read and save are required");
  }
  const ref = spotify.credentialRef;
  const tokens = createSpotifyTokenSource({
    clientId: spotify.clientId,
    readRefreshToken: () => credentialStore.read(ref),
    saveRefreshToken: (token) => credentialStore.save(ref, token),
    fetchImpl,
  });
  return withProviderBackoff(createSpotifyProvider({ getAccessToken: tokens.getAccessToken, forgetAccessToken: tokens.forget, fetchImpl }), backoff);
}

// Card source that picks between the media server (primary) and Spotify:
// whichever is playing wins. When both are playing, `prefer` settles it:
// "recent" (default, Rowan's call) shows whichever started playing most
// recently; "server" or "spotify" always pick that side. Nothing playing on
// either side shows the media server's state, as before; if the server
// fails, Spotify can still show.
export function combinePresence({ primary, secondary, prefer = "recent", now = Date.now }) {
  if (typeof primary?.getPresence !== "function" || typeof secondary?.getPresence !== "function") throw new TypeError("primary and secondary providers are required");
  if (!["recent", "server", "spotify"].includes(prefer)) throw new TypeError("prefer must be recent, server or spotify");
  // When each side started its current item (reset when it stops or changes).
  const started = { server: null, other: null };
  function track(side, result) {
    const value = result.status === "fulfilled" ? result.value : null;
    if (value?.state !== "playing") { started[side] = null; return; }
    const key = JSON.stringify([value.kind, value.title, value.subtitle]);
    if (started[side]?.key !== key) started[side] = { key, at: now() };
  }
  return Object.freeze({
    async getPresence() {
      const [server, other] = await Promise.allSettled([primary.getPresence(), secondary.getPresence()]);
      track("server", server);
      track("other", other);
      const playing = (result) => result.status === "fulfilled" && result.value?.state === "playing";
      if (playing(server) && playing(other)) {
        if (prefer === "server") return server.value;
        if (prefer === "spotify") return other.value;
        return started.other.at > started.server.at ? other.value : server.value;
      }
      if (playing(server)) return server.value;
      if (playing(other)) return other.value;
      if (server.status === "fulfilled") return server.value;
      throw server.reason;
    },
  });
}
