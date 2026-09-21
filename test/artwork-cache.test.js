import test from "node:test";
import assert from "node:assert/strict";

import { artworkCacheKey, createArtworkCache } from "../src/artwork-cache.js";

test("returns values until their TTL expires", () => {
  let time = 100;
  const cache = createArtworkCache({ ttlMs: 50, negativeTtlMs: 10, now: () => time });
  cache.set("a", new Uint8Array([1]));
  assert.deepEqual(cache.get("a"), new Uint8Array([1]));
  time = 150;
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.size, 0);
});

test("negative-caches missing artwork for a shorter TTL", () => {
  let time = 0;
  const cache = createArtworkCache({ ttlMs: 100, negativeTtlMs: 10, now: () => time });
  cache.set("missing", null);
  assert.equal(cache.get("missing"), null);
  time = 10;
  assert.equal(cache.get("missing"), undefined);
});

test("evicts the least recently used entry", () => {
  const cache = createArtworkCache({ maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
});

test("cache keys include provider, image version and size without credentials", () => {
  const one = artworkCacheKey(
    { provider: "jellyfin", itemId: "item/1", imageTag: "v1", type: "primary" },
    { width: 320, height: 180 },
  );
  const two = artworkCacheKey(
    { provider: "jellyfin", itemId: "item/1", imageTag: "v2", type: "primary" },
    { width: 320, height: 180 },
  );
  assert.notEqual(one, two);
  assert.match(one, /jellyfin:primary:item%2F1:v1:320x180/);
  assert.doesNotMatch(one, /token|api/i);
});

test("validates options and key material", () => {
  assert.throws(() => createArtworkCache({ maxEntries: 0 }), /maxEntries/);
  assert.throws(() => artworkCacheKey({ provider: "plex", type: "thumb" }), /missing provider/);
  assert.throws(
    () => artworkCacheKey({ provider: "plex", imageId: "/thumb", type: "thumb" }, { width: 2048 }),
    /width: must be between 1 and 1024/,
  );
});
