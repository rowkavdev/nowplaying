export function createSharpArtworkSanitizer({ sharpFactory, quality = 85 } = {}) {
  if (typeof sharpFactory !== "function") throw new TypeError("sharpFactory: expected a function");
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new RangeError("quality: must be between 1 and 100");

  return async function sanitize(artwork, { width = 256, height = 256 } = {}) {
    if (!artwork || !(artwork.bytes instanceof Uint8Array)) throw new TypeError("artwork: expected validated raster bytes");
    for (const [name, value] of Object.entries({ width, height })) {
      if (!Number.isInteger(value) || value < 1 || value > 1024) throw new RangeError(`${name}: must be between 1 and 1024`);
    }
    const image = sharpFactory(Buffer.from(artwork.bytes), { animated: false, failOn: "warning", limitInputPixels: 16_000_000 });
    const { data, info } = await image
      .rotate()
      .resize({ width, height, fit: "cover", withoutEnlargement: true })
      .png({ compressionLevel: 9, quality, force: true })
      .toBuffer({ resolveWithObject: true });
    if (!info || !Number.isInteger(info.width) || !Number.isInteger(info.height)) throw new TypeError("sharp: expected output dimensions");
    return Object.freeze({ contentType: "image/png", bytes: new Uint8Array(data), width: info.width, height: info.height });
  };
}
