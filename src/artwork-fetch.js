import { readBoundedBytes } from "./bounded-response.js";
import { validateRasterDimensions } from "./raster-dimensions.js";


const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function fetchArtwork(request, {
  fetchImpl = fetch,
  timeoutMs = 5_000,
  maxBytes = 1_000_000,
  maxPixels = 16_000_000,
} = {}) {
  if (request === null || typeof request !== "object" || typeof request.url !== "string") {
    throw new TypeError("request: expected an artwork request descriptor");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl: expected a function");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new RangeError("timeoutMs: must be between 1 and 30000");
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 5_000_000) throw new RangeError("maxBytes: must be between 1 and 5000000");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchSameHost(fetchImpl, request, controller.signal);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Artwork request failed: ${response.status} ${response.statusText}`);
    const contentType = response.headers?.get?.("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) throw new TypeError(`Artwork content type is not allowed: ${contentType || "missing"}`);
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new RangeError("Artwork exceeds maximum byte size");
    // Chunked responses have no Content-Length, so stop reading as soon as
    // the cap is passed instead of buffering the whole body first.
    const bytes = await readBoundedBytes(response, maxBytes, "Artwork").catch((error) => {
      throw /too large/.test(error?.message) ? new RangeError("Artwork exceeds maximum byte size") : error;
    });
    validateMagic(bytes, contentType);
    const dimensions = validateRasterDimensions(bytes, contentType, { maxPixels });
    return Object.freeze({ contentType, bytes, ...dimensions });
  } finally {
    clearTimeout(timer);
  }
}

const MAX_REDIRECTS = 3;

// Follow a redirect by hand only when it stays on the same host (a port change
// or http -> https is fine, e.g. a reverse proxy upgrading to TLS). Anything
// else is refused so the provider token header never goes to another host.
async function fetchSameHost(fetchImpl, request, signal) {
  let url = request.url;
  for (let hops = 0; ; hops += 1) {
    const response = await fetchImpl(url, { headers: request.headers, signal, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (hops >= MAX_REDIRECTS) throw new Error("Artwork request redirected too many times");
    const location = response.headers?.get?.("location");
    if (!location) throw new Error(`Artwork request failed: ${response.status} redirect without a location`);
    const from = new URL(url);
    const to = new URL(location, from);
    const protocolOk = to.protocol === from.protocol || (from.protocol === "http:" && to.protocol === "https:");
    if (to.hostname !== from.hostname || !protocolOk) throw new Error("Artwork request redirected to a different host");
    url = to.toString();
  }
}

function validateMagic(bytes, contentType) {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  const valid = contentType === "image/jpeg" ? jpeg : contentType === "image/png" ? png : webp;
  if (!valid) throw new TypeError("Artwork bytes do not match the declared content type");
}

export function artworkDataUri(artwork) {
  if (artwork === null) return null;
  if (artwork === undefined || !ALLOWED_TYPES.has(artwork.contentType) || !(artwork.bytes instanceof Uint8Array)) {
    throw new TypeError("artwork: expected validated artwork bytes");
  }
  return `data:${artwork.contentType};base64,${Buffer.from(artwork.bytes).toString("base64")}`;
}
