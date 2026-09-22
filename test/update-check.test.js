import test from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate } from "../src/update-check.js";

function fetchReleases(releases, status = 200) { return async () => ({ ok: status === 200, status, json: async () => releases }); }
function release(version, { prerelease = true, assetsVersion = version } = {}) {
  return { tag_name: `v${version}`, prerelease, draft: false, html_url: `release-${version}`, assets: [{ name: `nowplaying-v${assetsVersion}.tar.gz`, url: `asset-${version}` }, { name: "SHA256SUMS", url: `sums-${version}` }] };
}
const assets = [{ name: "nowplaying-v0.2.0.tar.gz", url: "asset" }, { name: "SHA256SUMS", url: "sums" }];

test("finds a plain-semver private prerelease from release metadata", async () => {
  const result = await checkForUpdate({ currentVersion: "0.1.0", repository: "rowkav09/nowplaying", token: "secret", channel: "beta", fetchImpl: fetchReleases([{ tag_name: "v0.2.0", prerelease: true, draft: false, html_url: "release", assets }]) });
  assert.deepEqual(result, { available: true, currentVersion: "0.1.0", version: "0.2.0", releaseUrl: "release", assetUrl: "asset", checksumUrl: "sums" });
});

test("preserves and orders prerelease identifiers", async () => {
  const result = await checkForUpdate({ currentVersion: "0.2.1-beta.2", repository: "x/y", channel: "beta", fetchImpl: fetchReleases([release("0.2.1-beta.2"), release("0.2.1-beta.10"), release("0.2.1-alpha.99")]) });
  assert.deepEqual(result, { available: true, currentVersion: "0.2.1-beta.2", version: "0.2.1-beta.10", releaseUrl: "release-0.2.1-beta.10", assetUrl: "asset-0.2.1-beta.10", checksumUrl: "sums-0.2.1-beta.10" });
});

test("does not downgrade prereleases or replace stable with same-core prerelease", async () => {
  assert.deepEqual(await checkForUpdate({ currentVersion: "0.2.1-beta.10", repository: "x/y", channel: "beta", fetchImpl: fetchReleases([release("0.2.1-beta.2")]) }), { available: false, currentVersion: "0.2.1-beta.10" });
  assert.deepEqual(await checkForUpdate({ currentVersion: "0.2.1", repository: "x/y", channel: "beta", fetchImpl: fetchReleases([release("0.2.1-beta.99")]) }), { available: false, currentVersion: "0.2.1" });
});

test("uses SemVer numeric, lexical and identifier-length precedence", async () => {
  const candidates = [release("0.2.1-beta"), release("0.2.1-beta.2"), release("0.2.1-beta.11"), release("0.2.1-rc.1")];
  const result = await checkForUpdate({ currentVersion: "0.2.1-beta", repository: "x/y", channel: "beta", fetchImpl: fetchReleases(candidates) });
  assert.equal(result.version, "0.2.1-rc.1");
});

test("binds asset lookup to the exact prerelease version", async () => {
  await assert.rejects(checkForUpdate({ currentVersion: "0.2.1-beta.1", repository: "x/y", channel: "beta", fetchImpl: fetchReleases([release("0.2.1-beta.2", { assetsVersion: "0.2.1" })]) }), /missing verified assets/);
});

test("rejects malformed and leading-zero prerelease identifiers", async () => {
  for (const version of ["0.2.1-beta..1", "0.2.1-01", "0.2.1-beta+build", "0.2.1-"]) {
    await assert.rejects(checkForUpdate({ currentVersion: version, repository: "x/y", channel: "beta", fetchImpl: fetchReleases([]) }), /expected semver/, version);
  }
});

test("does not cross stable and prerelease channels", async () => {
  const beta = [{ tag_name: "v1.0.0", prerelease: true, draft: false, assets: [{ name: "nowplaying-v1.0.0.tar.gz" }, { name: "SHA256SUMS" }] }];
  assert.deepEqual(await checkForUpdate({ currentVersion: "0.1.0", repository: "x/y", channel: "stable", fetchImpl: fetchReleases(beta) }), { available: false, currentVersion: "0.1.0" });
});

test("rejects missing assets and sanitized API failures", async () => {
  await assert.rejects(checkForUpdate({ currentVersion: "0.1.0", repository: "x/y", fetchImpl: fetchReleases([], 403) }), /update check failed \(403\)/);
  await assert.rejects(checkForUpdate({ currentVersion: "0.1.0", repository: "x/y", fetchImpl: fetchReleases([{ tag_name: "v0.2.0", prerelease: false, draft: false, assets: [] }]) }), /missing verified assets/);
});
