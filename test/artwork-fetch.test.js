
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

test("fetches validated raster bytes and handles redirects itself", async () => {
  let init;
  const artwork = await fetchArtwork(
    { url: "https://media.example.test/image", headers: { Authorization: "secret" } },
    { fetchImpl: async (_url, options) => { init = options; return response(); } },
  );
  assert.equal(init.redirect, "manual");
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

test("stops reading a chunked body without Content-Length once it passes maxBytes", async () => {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > 50) return controller.close();
      controller.enqueue(pulled === 1 ? png : new Uint8Array(100_000));
    },
    cancel() { cancelled = true; },
  });
  const chunked = new Response(body, { headers: { "content-type": "image/png" } });
  await assert.rejects(
    fetchArtwork({ url: "https://media.example.test/huge" }, { fetchImpl: async () => chunked, maxBytes: 250_000 }),
    /maximum byte size/,
  );
  assert.ok(pulled <= 5, `read ${pulled} chunks before giving up`);
  assert.equal(cancelled, true);
});

test("reads a streamed body under the cap", async () => {
  const ok = new Response(new ReadableStream({ start(c) { c.enqueue(png.slice(0, 10)); c.enqueue(png.slice(10)); c.close(); } }), { headers: { "content-type": "image/png" } });
  const artwork = await fetchArtwork({ url: "https://media.example.test/ok" }, { fetchImpl: async () => ok });
  assert.deepEqual(artwork.bytes, png);
});

function redirect(location, status = 302) {
  return { ok: false, status, statusText: "Found", headers: { get(name) { return name === "location" ? location : null; } } };
}

test("follows same-host redirects, including a port change and http to https", async () => {
  const seen = [];
  const hops = { "http://media.example.test:8096/image": redirect("https://media.example.test/image", 301), "https://media.example.test/image": redirect("/jellyfin/image", 307) };
  const artwork = await fetchArtwork(
    { url: "http://media.example.test:8096/image", headers: { "X-Emby-Token": "secret" } },
    { fetchImpl: async (url, options) => { seen.push([url, options.headers["X-Emby-Token"], options.redirect]); return hops[url] ?? response(); } },
  );
  assert.equal(artwork.contentType, "image/png");
  assert.deepEqual(seen, [
    ["http://media.example.test:8096/image", "secret", "manual"],
    ["https://media.example.test/image", "secret", "manual"],
    ["https://media.example.test/jellyfin/image", "secret", "manual"],
  ]);
});

test("refuses redirects to another host, https to http, a missing location or a loop", async () => {
  for (const [start, location, pattern] of [
    ["https://media.example.test/image", "https://other.example.test/image", /different host/],
    ["https://media.example.test/image", "https://media.example.test.evil.test/image", /different host/],
    ["https://media.example.test/image", "http://media.example.test/image", /different host/],
    ["https://media.example.test/image", null, /without a location/],
  ]) {
    const urls = [];
    await assert.rejects(fetchArtwork({ url: start, headers: { "X-Plex-Token": "secret" } }, { fetchImpl: async (url) => { urls.push(url); return redirect(location); } }), pattern);
    assert.deepEqual(urls, [start], "the token header is only ever sent to the original URL");
  }
  let calls = 0;
  await assert.rejects(
    fetchArtwork({ url: "https://media.example.test/a" }, { fetchImpl: async () => { calls += 1; return redirect("/a"); } }),
    /too many times/,
  );
  assert.equal(calls, 4);
});
