// Lenient readers for optional episode and movie details (#143). Media servers
// sometimes send numbers as strings or odd values; anything that doesn't fit
// the presence model is dropped as null, never thrown.

export function optionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function whole(value) {
  const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return Number.isInteger(n) ? n : null;
}

export function optionalCount(value) {
  const n = whole(value);
  return n !== null && n >= 0 && n <= 9999 ? n : null;
}

export function optionalYear(value) {
  const n = whole(value);
  return n !== null && n >= 1800 && n <= 2200 ? n : null;
}

// Position and length as the presence model accepts them. Servers report a
// position a little past the end at the end of a track, a length of 0 for
// live TV and internet radio, and seeks past a wrong length. None of that
// should turn the whole poll into an error (and a backoff), so a 0 length is
// unknown and a position past the end is held at the end.
export function playbackTimes(positionMs, durationMs) {
  const position = Number.isFinite(positionMs) && positionMs >= 0 ? positionMs : null;
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
  return { positionMs: position !== null && duration !== null ? Math.min(position, duration) : position, durationMs: duration };
}

// One user can have several sessions at once: a TV left paused while music
// plays on a phone. The first match in the server's list is often the paused
// one, so a playing session wins over a paused one among the matches.
export function pickSession(sessions, matches, isPaused) {
  const found = sessions.filter(matches);
  return found.find((session) => !isPaused(session)) ?? found[0] ?? null;
}

// Media servers answer with a JSON list of sessions. Anything else (a
// reverse proxy's error page as JSON, an API change) is a clear error rather
// than a TypeError from deep inside the mapper.
export function sessionList(value, provider) {
  if (!Array.isArray(value)) throw new Error(`${provider} sessions response was not a list`);
  return value;
}

// "Artists" is a list on every server, but a plugin or an old version can send
// one string, or a list with blanks and numbers in it. Keep the usable names
// and fall back to the album artist; never throw (#143 lenient-fields rule).
export function artistLine(artists, albumArtist) {
  const names = (Array.isArray(artists) ? artists : [artists]).map(optionalText).filter(Boolean);
  return names.length ? names.join(", ") : optionalText(albumArtist);
}

// Artwork needs a string item id and a short string tag; anything else means
// no artwork, not a failed poll.
export function artworkRef(provider, itemId, imageTag) {
  const id = optionalText(itemId);
  const tag = optionalText(imageTag);
  return id && tag && tag.length <= 512 ? { provider, itemId: id, imageTag: tag, type: "primary" } : null;
}

// Artwork that is addressed by one id (Plex thumb, Navidrome cover): a short
// string, or no artwork.
export function imageRef(provider, imageId, type) {
  const id = optionalText(imageId);
  return id && id.length <= 512 ? { provider, imageId: id, type } : null;
}
