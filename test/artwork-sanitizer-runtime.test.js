import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createDefaultArtworkSanitizer } from "../src/artwork-sanitizer-runtime.js";

test("re-encodes a real raster as a bounded metadata-free PNG", async () => {
  const input = await sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } })
    .withMetadata({ exif: { IFD0: { ImageDescription: "private comment" } } })
    .jpeg()
    .toBuffer();
  const output = await createDefaultArtworkSanitizer()({ contentType: "image/jpeg", bytes: new Uint8Array(input), width: 4, height: 3 }, { width: 2, height: 2 });
  assert.equal(output.contentType, "image/png");
  assert.equal(output.width, 2); assert.equal(output.height, 2);
  const metadata = await sharp(output.bytes).metadata();
  assert.equal(metadata.format, "png"); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined); assert.equal(metadata.xmp, undefined);
});
