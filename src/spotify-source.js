import { createSpotifyTokenSource } from "./spotify-auth.js";
import { createSpotifyProvider } from "./providers/spotify.js";
import { withProviderBackoff } from "./provider-backoff.js";

// Runtime pieces for Spotify (#135). Not wired into the app yet: which
// source wins when a media server and Spotify are both playing is waiting on
// Rowan, so the tiebreak is a parameter here.

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
  return withProviderBackoff(createSpotifyProvider({ getAccessToken: tokens.getAccessToken, fetchImpl }), backoff);
}

// Card source that picks between the media server (primary) and Spotify:
// whichever is playing wins. `prefer` settles a tie when both are playing
// ("server" or "spotify"). Nothing playing on either side shows the media
// server's state, as before; if the server fails, Spotify can still show.
export function combinePresence({ primary, secondary, prefer = "server" }) {
  if (typeof primary?.getPresence !== "function" || typeof secondary?.getPresence !== "function") throw new TypeError("primary and secondary providers are required");
  if (prefer !== "server" && prefer !== "spotify") throw new TypeError("prefer must be server or spotify");
  return Object.freeze({
    async getPresence() {
      const [server, other] = await Promise.allSettled([primary.getPresence(), secondary.getPresence()]);
      const playing = (result) => result.status === "fulfilled" && result.value?.state === "playing";
      if (playing(server) && playing(other)) return prefer === "server" ? server.value : other.value;
      if (playing(server)) return server.value;
      if (playing(other)) return other.value;
      if (server.status === "fulfilled") return server.value;
      throw server.reason;
    },
  });
}
