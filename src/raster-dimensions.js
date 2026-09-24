const MAX_PIXELS = 16_000_000;

export function validateRasterDimensions(bytes, contentType, { maxPixels = MAX_PIXELS } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("bytes: expected Uint8Array");
  if (!Number.isInteger(maxPixels) || maxPixels < 1 || maxPixels > MAX_PIXELS) throw new RangeError(`maxPixels: must be between 1 and ${MAX_PIXELS}`);
  const dimensions = contentType === "image/png" ? pngDimensions(bytes)
    : contentType === "image/webp" ? webpDimensions(bytes)
    : contentType === "image/jpeg" ? jpegDimensions(bytes)
    : null;
  if (!dimensions) throw new TypeError("Artwork dimensions could not be decoded");
  const { width, height } = dimensions;
  if (width < 1 || height < 1 || width * height > maxPixels) throw new RangeError("Artwork exceeds maximum pixel dimensions");
  return Object.freeze({ width, height });
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || text(bytes, 12, 4) !== "IHDR") return null;
  return { width: u32(bytes, 16), height: u32(bytes, 20) };
}

function webpDimensions(bytes) {
  if (bytes.length < 30) return null;
  const kind = text(bytes, 12, 4);
  // Simple lossy WebP (what cwebp and most tools write): the key frame
  // start code 9d 01 2a, then 14-bit width and height.
  if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
  }
  if (kind === "VP8X") return { width: u24(bytes, 24) + 1, height: u24(bytes, 27) + 1 };
  if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return { width: 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8)), height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)) };
  }
  return null;
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + length + 2 > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
    }
    offset += length + 2;
  }
  return null;
}

function text(bytes, start, length) { return String.fromCharCode(...bytes.slice(start, start + length)); }
function u32(bytes, start) { return ((bytes[start] << 24) | (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3]) >>> 0; }
function u24(bytes, start) { return bytes[start] | (bytes[start + 1] << 8) | (bytes[start + 2] << 16); }
