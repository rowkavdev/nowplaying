
import test from "node:test";
import assert from "node:assert/strict";

import { artworkDataUri, fetchArtwork } from "../src/artwork-fetch.js";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAAASUhEUgAAAAEAAAAB", "base64"));

function response({ status = 200, type = "image/png", bytes = png, length } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get(name) { return name === "content-type" ? type : name === "content-length" ? length == null ? null : String(length) : null; } },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

test("fetches validated raster bytes with no redirects", async () => {
  let init;
  const artwork = await fetchArtwork(
    { url: "https://media.example.test/image", headers: { Authorization: "secret" } },
    { fetchImpl: async (_url, options) => { init = options; return response(); } },
  );
  assert.equal(init.redirect, "error");
  assert.equal(init.headers.Authorization, "secret");
  assert.equal(artwork.contentType, "image/png");
  assert.deepEqual(artwork.bytes, png);
  assert.equal(Object.isFrozen(artwork), true);
});

test("returns null for missing artwork", async () => {
  const artwork = await fetchArtwork(
    { url: "https://media.example.test/missing", headers: {} },
    { fetchImpl: async () => response({ status: 404 }) },
  );
  assert.equal(artwork, null);
});

test("rejects active and mismatched content", async () => {
  await assert.rejects(
    () => fetchArtwork(
      { url: "https://media.example.test/image", headers: {} },
      { fetchImpl: async () => response({ type: "image/svg+xml" }) },
    ),
    /content type is not allowed/,
  );
  await assert.rejects(
    () => fetchArtwork(
      { url: "https://media.example.test/image", headers: {} },
      { fetchImpl: async () => response({ type: "image/jpeg", bytes: png }) },
    ),
    /bytes do not match/,
  );
});

test("rejects declared or actual oversized images", async () => {
  await assert.rejects(
    () => fetchArtwork(
      { url: "https://media.example.test/image", headers: {} },
      { maxBytes: 8, fetchImpl: async () => response({ length: 9 }) },
    ),
    /maximum byte size/,
  );
  await assert.rejects(
    () => fetchArtwork(
      { url: "https://media.example.test/image", headers: {} },
      { maxBytes: 8, fetchImpl: async () => response() },
    ),
    /maximum byte size/,
  );
});

test("creates self-contained raster data URIs", () => {
  assert.equal(artworkDataUri({ contentType: "image/png", bytes: png }), `data:image/png;base64,${Buffer.from(png).toString("base64")}`);
  assert.equal(artworkDataUri(null), null);
});
