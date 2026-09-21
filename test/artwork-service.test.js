

import test from "node:test";
import assert from "node:assert/strict";
import { createArtworkCache } from "../src/artwork-cache.js";
import { createArtworkService } from "../src/artwork-service.js";

const artwork = { provider: "jellyfin", type: "primary", itemId: "movie-1", imageTag: "v1" };
const config = { baseUrl: "http://media.local", apiKey: "secret" };
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAAASUhEUgAAAAEAAAAB", "base64"));
function response(status, bytes = png) {
  return { status, statusText: status === 404 ? "Not Found" : "OK", ok: status >= 200 && status < 300,
    headers: { get: (name) => name === "content-type" ? "image/png" : null },
    arrayBuffer: async () => bytes.buffer };
}

test("resolves a private provider request to a card-safe data URI and caches it", async () => {
  let calls = 0;
  const service = createArtworkService({ cache: createArtworkCache(), fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(url.startsWith("http://media.local/Items/movie-1/Images/Primary?"), true);
    assert.equal(options.headers["X-Emby-Token"], "secret");
    return response(200);
  }});
  const expected = "data:image/png;base64,iVBORw0KGgoAAAAASUhEUgAAAAEAAAAB";
  assert.equal(await service.resolve(artwork, config), expected);
  assert.equal(await service.resolve(artwork, config), expected);
  assert.equal(calls, 1);
});

test("negative-caches missing artwork without exposing provider URLs", async () => {
  let calls = 0;
  const service = createArtworkService({ cache: createArtworkCache(), fetchImpl: async () => { calls += 1; return response(404); } });
  assert.equal(await service.resolve(artwork, config), null);
  assert.equal(await service.resolve(artwork, config), null);
  assert.equal(calls, 1);
});

test("returns null without a provider request when presence has no artwork", async () => {
  const service = createArtworkService({ cache: createArtworkCache(), fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(await service.resolve(null, config), null);
});


test("sanitizes before caching or rendering artwork bytes", async () => {
  const cache=createArtworkCache(); let sanitizeCalls=0;
  const sanitized=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAAASUhEUgAAAAIAAAAC", "base64"));
  const service=createArtworkService({cache,fetchImpl:async()=>response(200),sanitizer:async(input)=>{sanitizeCalls+=1;assert.notDeepEqual(input.bytes,sanitized);return {contentType:"image/png",bytes:sanitized,width:2,height:2};}});
  const expected=`data:image/png;base64,${Buffer.from(sanitized).toString("base64")}`;
  assert.equal(await service.resolve(artwork,config),expected);
  assert.equal(await service.resolve(artwork,config),expected); assert.equal(sanitizeCalls,1);
});

test("rejects malformed sanitizer output before caching", async () => {
  const service=createArtworkService({cache:createArtworkCache(),fetchImpl:async()=>response(200),sanitizer:async()=>({contentType:"image/svg+xml",bytes:png,width:1,height:1})});
  await assert.rejects(()=>service.resolve(artwork,config),/validated raster output/);
});
