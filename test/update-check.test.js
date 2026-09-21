import test from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate } from "../src/update-check.js";

function fetchReleases(releases, status = 200) { return async (_url, options) => ({ ok: status === 200, status, json: async () => releases, options }); }
const assets = [{ name: "nowplaying-v0.2.0.tar.gz", url: "asset" }, { name: "SHA256SUMS", url: "sums" }];

test("finds a newer private prerelease with verified assets", async () => {
  const result = await checkForUpdate({ currentVersion: "0.1.0-beta", repository: "rowkav09/nowplaying", token: "secret", fetchImpl: fetchReleases([{ tag_name: "v0.2.0-beta", prerelease: true, draft: false, html_url: "release", assets }]) });
  assert.deepEqual(result, { available: true, currentVersion: "0.1.0", version: "0.2.0", releaseUrl: "release", assetUrl: "asset", checksumUrl: "sums" });
});

test("does not cross stable and prerelease channels", async () => {
  const result = await checkForUpdate({ currentVersion: "0.1.0-beta", repository: "rowkav09/nowplaying", fetchImpl: fetchReleases([{ tag_name: "v1.0.0", prerelease: false, draft: false, assets: [] }]) });
  assert.deepEqual(result, { available: false, currentVersion: "0.1.0" });
});

test("rejects missing assets and sanitized API failures", async () => {
  await assert.rejects(checkForUpdate({ currentVersion: "0.1.0", repository: "x/y", fetchImpl: fetchReleases([], 403) }), /update check failed \(403\)/);
  await assert.rejects(checkForUpdate({ currentVersion: "0.1.0", repository: "x/y", fetchImpl: fetchReleases([{ tag_name: "v0.2.0", draft: false, assets: [] }]) }), /missing verified assets/);
});
