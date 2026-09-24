import { createPresence } from "./presence.js";

// Which kinds of media a provider can report (#143). Navidrome is music-only;
// Plex, Jellyfin and Emby cover music, TV episodes and films.
export const MEDIA_KINDS = Object.freeze(["track", "episode", "movie"]);

export function defineProvider({ id, getPresence, whoami, mediaKinds = MEDIA_KINDS }) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new TypeError("Provider id must be a lowercase slug");
  }
  if (typeof getPresence !== "function") {
    throw new TypeError("Provider getPresence must be a function");
  }

  if (whoami !== undefined && typeof whoami !== "function") {
    throw new TypeError("Provider whoami must be a function when set");
  }

  if (!Array.isArray(mediaKinds) || !mediaKinds.length || mediaKinds.some((kind) => !MEDIA_KINDS.includes(kind))) {
    throw new TypeError("Provider mediaKinds must list track, episode or movie");
  }
  const kinds = Object.freeze(MEDIA_KINDS.filter((kind) => mediaKinds.includes(kind)));

  return Object.freeze({
    id,
    mediaKinds: kinds,
    async getPresence(context = {}) {
      const presence = createPresence(await getPresence(context));
      // A kind the provider doesn't claim is reported as unknown rather than
      // passed on as something it can't really describe. A whole-series item
      // ("show") counts as TV.
      const claimed = presence.kind === "show" ? kinds.includes("episode") : kinds.includes(presence.kind);
      return presence.kind === "unknown" || claimed ? presence : createPresence({ ...presence, kind: "unknown", series: null, season: null, episode: null });
    },
    // Optional: which user the server says the saved sign-in belongs to,
    // as { id, displayName }. Used by setup to catch user mismatches.
    ...(whoami ? { whoami } : {}),
  });
}
