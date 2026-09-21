import test from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate } from "../src/update-check.js";

function fetchReleases(releases, status = 200) { return async () => ({ ok: status === 200, status, json: async () => releases }); }
const assets = [{ name: "nowplaying-v0.2.0.tar.gz", url: "asset" }, { name: "SHA256SUMS", url: "sums" }];

test("finds a plain-semver private prerelease from release metadata", async () => {
  const result = await checkForUpdate({ currentVersion: "0.1.0", repository: "rowkav09/nowplaying", token: "secret", channel: "beta", fetchImpl: fetchReleases([{ tag_name: "v0.2.0", prerelease: true, draft: false, html_url: "release", assets }]) });
  assert.deepEqual(result, { available: true, currentVersion: "0.1.0", version: "0.2.0", releaseUrl: "release", assetUrl: "asset", checksumUrl: "sums" });
});

test("does not cross stable and prerelease channels", async () => {
  const beta = [{ tag_name: "v1.0.0", prerelease: true, draft: false, assets: [{ name: "nowplaying-v1.0.0.tar.gz" }, { name: "SHA256SUMS" }] }];
  assert.deepEqual(await checkForUpdate({ currentVersion: "0.1.0", repository: "x/y", channel: "stable", fetchImpl: fetchReleases(beta) }), { available: false, currentVersion: "0.1.0" });
});

test("rejects missing assets and sanitized API failures", async () => {
  await assert.rejects(checkForUpdate({ currentVersion: "0.1.0", repository: "x/y", fetchImpl: fetchReleases([], 403) }), /update check failed \(403\)/);
  await assert.rejects(checkForUpdate({ currentVersion: "0.1.0", repository: "x/y", fetchImpl: fetchReleases([{ tag_name: "v0.2.0", prerelease: false, draft: false, assets: [] }]) }), /missing verified assets/);
});
