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
