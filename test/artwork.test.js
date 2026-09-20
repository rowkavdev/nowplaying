import test from "node:test";
import assert from "node:assert/strict";

import { createArtworkRequest } from "../src/artwork.js";

test("builds a bounded Plex photo-transcode request", () => {
  const request = createArtworkRequest(
    { provider: "plex", imageId: "/library/metadata/1/thumb/2", type: "thumb" },
    { baseUrl: "https://plex.example.test/", token: "secret" },
    { width: 320, height: 180 },
  );
  const url = new URL(request.url);
  assert.equal(url.pathname, "/photo/:/transcode");
  assert.equal(url.searchParams.get("url"), "/library/metadata/1/thumb/2");
  assert.equal(url.searchParams.get("width"), "320");
  assert.equal(url.searchParams.get("height"), "180");
  assert.equal(url.searchParams.has("X-Plex-Token"), false);
  assert.equal(request.headers["X-Plex-Token"], "secret");
});

test("builds Jellyfin and Emby primary-image requests with header auth", () => {
  for (const provider of ["jellyfin", "emby"]) {
    const request = createArtworkRequest(
      { provider, itemId: "item / 1", imageTag: "v2", type: "primary" },
      { baseUrl: `https://${provider}.example.test`, apiKey: "secret" },
    );
    const url = new URL(request.url);
    assert.equal(url.pathname, "/Items/item%20%2F%201/Images/Primary");
    assert.equal(url.searchParams.get("maxWidth"), "256");
    assert.equal(url.searchParams.get("tag"), "v2");
    assert.equal(url.searchParams.has("api_key"), false);
    assert.equal(request.headers["X-Emby-Token"], "secret");
  }
});

test("builds a bounded Navidrome Subsonic cover-art request", () => {
  const request = createArtworkRequest(
    { provider: "navidrome", imageId: "cover-1", type: "cover" },
    { baseUrl: "https://music.example.test", username: "user", token: "hash", salt: "salt" },
    { width: 512, height: 512 },
  );
  const url = new URL(request.url);
  assert.equal(url.pathname, "/rest/getCoverArt.view");
  assert.equal(url.searchParams.get("id"), "cover-1");
  assert.equal(url.searchParams.get("size"), "512");
  assert.equal(url.searchParams.get("t"), "hash");
});

test("rejects arbitrary Plex paths and unbounded dimensions", () => {
  assert.throws(
    () => createArtworkRequest(
      { provider: "plex", imageId: "https://attacker.example/image", type: "thumb" },
      { baseUrl: "https://plex.example.test", token: "secret" },
    ),
    { message: "Plex artwork imageId must be an absolute server path" },
  );
  assert.throws(
    () => createArtworkRequest(
      { provider: "emby", itemId: "1", type: "primary" },
      { baseUrl: "https://emby.example.test", apiKey: "secret" },
      { width: 4096, height: 256 },
    ),
    { message: "width: must be an integer between 1 and 1024" },
  );
});

test("requires provider credentials and a known provider", () => {
  assert.throws(
    () => createArtworkRequest(
      { provider: "jellyfin", itemId: "1", type: "primary" },
      { baseUrl: "https://jellyfin.example.test" },
    ),
    { message: "Jellyfin apiKey is required" },
  );
  assert.throws(
    () => createArtworkRequest(
      { provider: "http", imageId: "https://attacker.example", type: "primary" },
      { baseUrl: "https://media.example.test" },
    ),
    { message: "Unsupported artwork provider: http" },
  );
});
