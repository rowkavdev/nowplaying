// Shared wire limits. Only small, metadata-free PNGs can enter public cards.
export const MAX_HOSTED_ARTWORK_BYTES = 48 * 1024;
export const MAX_HOSTED_ARTWORK_LENGTH = Math.ceil(MAX_HOSTED_ARTWORK_BYTES / 3) * 4 + 22;
const PREFIX = "data:image/png;base64,";
export function isHostedArtwork(value) {
  if (typeof value !== "string" || value.length > MAX_HOSTED_ARTWORK_LENGTH || !value.startsWith(PREFIX)) return false;
  const encoded = value.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || bytes.length > MAX_HOSTED_ARTWORK_BYTES || bytes.length < 45 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return false;
  let offset = 8, header = false, data = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) return false;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "pHYs"].includes(type)) return false;
    if (!header && type !== "IHDR") return false;
    if (type === "IHDR") {
      if (header || size !== 13) return false;
      const width = bytes.readUInt32BE(offset + 8), height = bytes.readUInt32BE(offset + 12);
      if (width < 1 || height < 1 || width > 256 || height > 256) return false;
      header = true;
    }
    if (type === "IDAT") data = true;
    offset += size + 12;
    if (type === "IEND") return size === 0 && data && offset === bytes.length;
  }
  return false;
}
