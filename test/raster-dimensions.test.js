import test from "node:test";
import assert from "node:assert/strict";
import { validateRasterDimensions } from "../src/raster-dimensions.js";

function png(width, height) {
  const b = new Uint8Array(24); b.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a], 0); b.set([0x49,0x48,0x44,0x52], 12);
  new DataView(b.buffer).setUint32(16, width); new DataView(b.buffer).setUint32(20, height); return b;
}
function webp(width, height) {
  const b = new Uint8Array(30); b.set(Buffer.from("RIFF"),0); b.set(Buffer.from("WEBP"),8); b.set(Buffer.from("VP8X"),12);
  for (const [start, value] of [[24,width-1],[27,height-1]]) { b[start]=value&255;b[start+1]=(value>>8)&255;b[start+2]=(value>>16)&255; } return b;
}
function jpeg(width, height) { return Uint8Array.from([0xff,0xd8,0xff,0xc0,0,8,8,height>>8,height&255,width>>8,width&255,1]); }

test("decodes bounded PNG, WebP and JPEG dimensions", () => {
  assert.deepEqual(validateRasterDimensions(png(640,480), "image/png"), { width:640, height:480 });
  assert.deepEqual(validateRasterDimensions(webp(320,200), "image/webp"), { width:320, height:200 });
  assert.deepEqual(validateRasterDimensions(jpeg(800,600), "image/jpeg"), { width:800, height:600 });
});

test("rejects oversized raster dimensions", () => {
  assert.throws(() => validateRasterDimensions(png(5000,5000), "image/png"), /maximum pixel dimensions/);
  assert.throws(() => validateRasterDimensions(webp(5000,5000), "image/webp"), /maximum pixel dimensions/);
});

test("rejects truncated or unsupported raster headers", () => {
  assert.throws(() => validateRasterDimensions(Uint8Array.from([0x89,0x50]), "image/png"), /could not be decoded/);
  assert.throws(() => validateRasterDimensions(Uint8Array.from([0xff,0xd8]), "image/jpeg"), /could not be decoded/);
});

function webpLossless(width, height) {
  const b = new Uint8Array(30); b.set(Buffer.from("RIFF"),0); b.set(Buffer.from("WEBP"),8); b.set(Buffer.from("VP8L"),12);
  b[20] = 0x2f; b[21] = (width-1) & 255; b[22] = ((width-1) >> 8) & 0x3f;
  const h = height-1; b[22] |= (h & 3) << 6; b[23] = (h >> 2) & 255; b[24] = (h >> 10) & 0x0f;
  return b;
}
function jpegWithAppSegment(width, height) {
  return Uint8Array.from([0xff,0xd8, 0xff,0xe0, 0x00,0x04, 0xaa,0xbb, 0xff,0xc0, 0x00,0x08, 0x08, height>>8, height&255, width>>8, width&255, 0x01]);
}

test("decodes lossless WebP (VP8L) dimensions", () => {
  assert.deepEqual(validateRasterDimensions(webpLossless(100, 49), "image/webp"), { width:100, height:49 });
});

test("walks past non-image JPEG segments to find the dimensions", () => {
  assert.deepEqual(validateRasterDimensions(jpegWithAppSegment(300, 200), "image/jpeg"), { width:300, height:200 });
});

// Header of a real 300x200 lossy WebP written by libwebp (sharp .webp()).
function lossyWebp(width, height) {
  const b = new Uint8Array(30); b.set(Buffer.from("RIFF"),0); b.set(Buffer.from("WEBP"),8); b.set(Buffer.from("VP8 "),12);
  b.set([0x9d,0x01,0x2a],23); b[26]=width&255; b[27]=(width>>8)&0x3f; b[28]=height&255; b[29]=(height>>8)&0x3f; return b;
}

test("decodes simple lossy (VP8) WebP dimensions", () => {
  assert.deepEqual(validateRasterDimensions(lossyWebp(300,200), "image/webp"), { width:300, height:200 });
  assert.deepEqual(validateRasterDimensions(lossyWebp(16383,1), "image/webp"), { width:16383, height:1 });
  assert.throws(() => validateRasterDimensions(lossyWebp(5000,5000), "image/webp"), /maximum pixel dimensions/);
  const noStartCode = lossyWebp(300,200); noStartCode[23] = 0;
  assert.throws(() => validateRasterDimensions(noStartCode, "image/webp"), /could not be decoded/);
});

function fillBefore(buffer, markerOffset, count) {
  return Buffer.concat([buffer.subarray(0, markerOffset), Buffer.alloc(count, 0xff), buffer.subarray(markerOffset)]);
}
async function sharpJpeg(width = 16, height = 16) {
  const { default: sharp } = await import("sharp");
  return sharp({ create: { width, height, channels: 3, background: "#123456" } }).jpeg().toBuffer();
}
function markerOffset(buffer, marker) {
  for (let i = 2; i + 1 < buffer.length; i++) if (buffer[i] === 0xff && buffer[i + 1] === marker) return i;
  throw new Error("marker not found");
}

test("JPEG marker fill bytes before SOI successors, APP and SOF still decode dimensions", async () => {
  const { default: sharp } = await import("sharp");
  const plain = await sharpJpeg(16, 12);
  // Add an APP15 segment so there is an APP marker to pad as well.
  const original = Buffer.concat([plain.subarray(0, 2), Buffer.from([0xff, 0xef, 0x00, 0x04, 0xaa, 0xbb]), plain.subarray(2)]);
  for (const offset of [2, markerOffset(original, 0xef), markerOffset(original, 0xc0)]) {
    for (const count of [1, 3, 40]) {
      const padded = fillBefore(original, offset, count);
      await sharp(padded, { failOn: "warning" }).raw().toBuffer();
      assert.deepEqual(validateRasterDimensions(padded, "image/jpeg"), { width: 16, height: 12 });
    }
  }
});

test("JPEG fill-byte parsing stays bounded and rejects truncation and the pixel cap", async () => {
  const original = await sharpJpeg(16, 16);
  const sof = markerOffset(original, 0xc0);
  assert.throws(() => validateRasterDimensions(Buffer.concat([original.subarray(0, 2), Buffer.alloc(100000, 0xff)]), "image/jpeg"), /could not be decoded/);
  assert.throws(() => validateRasterDimensions(fillBefore(original, sof, 5).subarray(0, sof + 5), "image/jpeg"), /could not be decoded/);
  assert.throws(() => validateRasterDimensions(fillBefore(jpeg(5000, 5000), 2, 4), "image/jpeg"), /maximum pixel dimensions/);
});

test("fetchArtwork passes padded JPEG artwork to the sanitizer", async () => {
  const { fetchArtwork } = await import("../src/artwork-fetch.js");
  const original = await sharpJpeg(16, 16);
  const padded = fillBefore(original, 2, 1);
  const result = await fetchArtwork({ url: "https://media.example/art", headers: {} }, {
    fetchImpl: async () => new Response(padded, { status: 200, headers: { "Content-Type": "image/jpeg", "Content-Length": String(padded.length) } }),
  });
  assert.ok(result);
});
