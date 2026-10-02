// Display names for the sources a track can come from, for the {service}
// template token. Unknown ids fall back to the id with a capital letter.
const PROVIDER_NAMES = Object.freeze({ spotify: "Spotify", navidrome: "Navidrome", plex: "Plex", jellyfin: "Jellyfin", emby: "Emby" });

export function providerDisplayName(id) {
  if (typeof id !== "string" || id === "") return "";
  // Own keys only: a valid slug such as "constructor" must not hit Object.prototype.
  if (Object.hasOwn(PROVIDER_NAMES, id)) return PROVIDER_NAMES[id];
  return id.charAt(0).toUpperCase() + id.slice(1);
}
