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
