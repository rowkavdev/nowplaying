import { createSpotifyTokenSource } from "./spotify-auth.js";
import { createSpotifyProvider } from "./providers/spotify.js";
import { withProviderBackoff } from "./provider-backoff.js";
import { presenceItemKey } from "./presence-identity.js";
import { nextPresenceActivityOrder, PRESENCE_ACTIVITY_ORDER } from "./presence-activity.js";

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
export function combinePresence({ primary, secondary, prefer = "recent" }) {
  if (typeof primary?.getPresence !== "function" || typeof secondary?.getPresence !== "function") throw new TypeError("primary and secondary providers are required");
  if (!["recent", "server", "spotify"].includes(prefer)) throw new TypeError("prefer must be recent, server or spotify");
  // Process-local activity order survives adjustments to the PC wall clock.
  // Reset a side when it stops; an unchanged item keeps its earlier priority.
  const started = { server: null, other: null };
  const activityByPresence = new WeakMap();
  function track(side, source, result) {
    // A failed poll is unknown playback, not a stop/resume.
    if (result.status !== "fulfilled") return;
    const value = result.value;
    if (value?.state !== "playing") { started[side] = null; return; }
    const key = presenceItemKey(value);
    const inheritedOrder = source[PRESENCE_ACTIVITY_ORDER]?.(value);
    if (inheritedOrder != null) started[side] = { key, order: inheritedOrder };
    else if (started[side]?.key !== key) started[side] = { key, order: nextPresenceActivityOrder() };
  }
  function selected(side, result) {
    if (result.value?.state === "playing") activityByPresence.set(result.value, started[side].order);
    return result.value;
  }
  return Object.freeze({
    [PRESENCE_ACTIVITY_ORDER]: (presence) => activityByPresence.get(presence) ?? null,
    async getPresence() {
      const [server, other] = await Promise.allSettled([primary.getPresence(), secondary.getPresence()]);
      track("server", primary, server);
      track("other", secondary, other);
      const playing = (result) => result.status === "fulfilled" && result.value?.state === "playing";
      if (playing(server) && playing(other)) {
        if (prefer === "server") return selected("server", server);
        if (prefer === "spotify") return selected("other", other);
        return started.other.order > started.server.order ? selected("other", other) : selected("server", server);
      }
      if (playing(server)) return selected("server", server);
      if (playing(other)) return selected("other", other);
      if (server.status === "fulfilled") return server.value;
      throw server.reason;
    },
  });
}
