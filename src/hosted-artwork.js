import { isHostedArtwork, MAX_HOSTED_ARTWORK_BYTES } from "./hosted-artwork-format.js";
// Covers already resolved on the PC are re-encoded to a bounded thumbnail.
// No source URLs, provider references or source metadata enter the payload.
const cache = new Map();
export async function compactHostedArtwork(art) {
  const dataUri = typeof art === "string" ? art : art?.dataUri;
  if (typeof dataUri !== "string" || dataUri.length > 1_500_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUri)) return null;
  if (cache.has(dataUri)) return cache.get(dataUri);
  const { default: sharp } = await import("sharp");
  const bytes = await sharp(Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64"), { animated: false, limitInputPixels: 1_000_000 })
    .rotate().resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true }).png({ palette: true, colours: 128, compressionLevel: 9 }).toBuffer();
  const value = bytes.length <= MAX_HOSTED_ARTWORK_BYTES ? `data:image/png;base64,${bytes.toString("base64")}` : null;
  const result = isHostedArtwork(value) ? value : null;
  if (cache.size >= 24) cache.delete(cache.keys().next().value);
  cache.set(dataUri, result);
  return result;
}
