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
