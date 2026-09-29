import test from "node:test";
import assert from "node:assert/strict";
import { fetchReleaseDownloadStats, summarizeReleaseDownloads } from "../src/release-stats.js";

const payload = [{ tag_name: "v0.2.0", prerelease: false, published_at: "2026-09-01T00:00:00Z", assets: [{ name: "nowplaying-v0.2.0.tar.gz", download_count: 7, size: 100 }] }];

function respond(body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: true, status: 200, headers: new Headers({ "content-length": String(Buffer.byteLength(text)) }), text: async () => text };
}

const stats = (fetchImpl) => fetchReleaseDownloadStats({ repository: "o/r", token: "t", fetchImpl });

test("reads the releases list within the byte cap", async () => {
  const releases = await stats(async () => respond(payload));
  assert.deepEqual(releases, [{ tag: "v0.2.0", prerelease: false, publishedAt: "2026-09-01T00:00:00Z", assets: [{ name: "nowplaying-v0.2.0.tar.gz", downloads: 7, size: 100 }] }]);
});

test("reads a streamed releases body without a Content-Length", async () => {
  const releases = await stats(async () => new Response(JSON.stringify(payload)));
  assert.equal(releases[0].tag, "v0.2.0");
});

test("rejects an over-cap releases response without reading it", async () => {
  let read = false;
  const response = { ok: true, status: 200, headers: new Headers({ "content-length": String(5 * 1024 * 1024) }), text: async () => { read = true; return "[]"; } };
  await assert.rejects(stats(async () => response), /release stats response is too large/);
  assert.equal(read, false);
});

test("rejects a lengthless non-streaming releases response without reading it", async () => {
  let read = false;
  const response = { ok: true, status: 200, text: async () => { read = true; return "[]"; } };
  await assert.rejects(stats(async () => response), /release stats response is too large/);
  assert.equal(read, false);
});

test("reports non-array and malformed releases JSON as invalid", async () => {
  await assert.rejects(stats(async () => respond({ nope: 1 })), /invalid response/);
  await assert.rejects(stats(async () => respond("{not json")), /invalid response/);
});

test("summarizes downloads per asset and in total", async () => {
  const summary = summarizeReleaseDownloads(await stats(async () => respond([
    { tag_name: "v0.1.0", prerelease: false, published_at: null, assets: [{ name: "a.zip", download_count: 3, size: 1 }, { name: "b.zip", download_count: 2, size: 1 }] },
    { tag_name: "v0.2.0", prerelease: true, published_at: null, assets: [{ name: "a.zip", download_count: 4, size: 1 }] },
  ])));
  assert.deepEqual(summary, { total: 9, byAsset: { "a.zip": 7, "b.zip": 2 } });
});
