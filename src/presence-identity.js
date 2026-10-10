// Artwork can carry a stable media-item ID even when two different tracks
// have the same title and artist. Fall back to display details for providers
// without one (for example Spotify), rather than treating progress or a new
// image tag as a new start. Image IDs may identify an album cover shared by
// multiple tracks, so they are not a media-item identity.
export function presenceItemKey(presence) {
  const artwork = presence?.artwork;
  const itemId = typeof artwork?.itemId === "string" && artwork.itemId.trim()
    ? [artwork.provider ?? null, artwork.itemId.trim()]
    : null;
  const key = [presence?.kind ?? null, presence?.title ?? null, presence?.subtitle ?? null, itemId];
  // Opaque item and cover IDs can collide across configured servers. Keep
  // untagged keys unchanged; image revisions on one source still do not
  // mark a new item, including providers that expose only a shared cover.
  if (Number.isInteger(artwork?.sourceIndex) && artwork.sourceIndex >= 0 && artwork.sourceIndex <= 7) key.push(artwork.sourceIndex);
  return JSON.stringify(key);
}
