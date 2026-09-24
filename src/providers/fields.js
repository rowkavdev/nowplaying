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
