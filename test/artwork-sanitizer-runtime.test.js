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

test("returns null for a fully transparent cover so the card shows no empty box", async () => {
  const input = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const output = await createDefaultArtworkSanitizer()({ contentType: "image/png", bytes: new Uint8Array(input), width: 8, height: 8 }, { width: 4, height: 4 });
  assert.equal(output, null);
});

test("flattens a partly transparent cover onto an opaque matte", async () => {
  const input = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const output = await createDefaultArtworkSanitizer()({ contentType: "image/png", bytes: new Uint8Array(input), width: 8, height: 8 }, { width: 4, height: 4 });
  const meta = await sharp(output.bytes).metadata();
  assert.equal(meta.hasAlpha, false);
});
