import test from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate, updateAssetName } from "../src/update-check.js";

function fetchReleases(releases, status = 200) { return async () => ({ ok: status === 200, status, json: async () => releases }); }
function release(version, { prerelease = true, assetsVersion = version } = {}) {
  return { tag_name: `v${version}`, prerelease, draft: false, html_url: `release-${version}`, assets: [{ name: `nowplaying-v${assetsVersion}.tar.gz`, url: `asset-${version}` }, { name: "SHA256SUMS", url: `sums-${version}` }] };
}
const assets = [{ name: "nowplaying-v0.2.0.tar.gz", url: "asset" }, { name: "SHA256SUMS", url: "sums" }];

test("finds a plain-semver private prerelease from release metadata", async () => {
  const result = await checkForUpdate({ platform: "linux", currentVersion: "0.1.0", repository: "rowkav09/nowplaying", token: "secret", channel: "beta", fetchImpl: fetchReleases([{ tag_name: "v0.2.0", prerelease: true, draft: false, html_url: "release", assets }]) });
  assert.deepEqual(result, { available: true, currentVersion: "0.1.0", version: "0.2.0", releaseUrl: "release", assetName: "nowplaying-v0.2.0.tar.gz", assetUrl: "asset", checksumUrl: "sums" });
});

test("preserves and orders prerelease identifiers", async () => {
  const result = await checkForUpdate({ platform: "linux", currentVersion: "0.2.1-beta.2", repository: "x/y", channel: "beta", fetchImpl: fetchReleases([release("0.2.1-beta.2"), release("0.2.1-beta.10"), release("0.2.1-alpha.99")]) });
  assert.deepEqual(result, { available: true, currentVersion: "0.2.1-beta.2", version: "0.2.1-beta.10", releaseUrl: "release-0.2.1-beta.10", assetName: "nowplaying-v0.2.1-beta.10.tar.gz", assetUrl: "asset-0.2.1-beta.10", checksumUrl: "sums-0.2.1-beta.10" });
});

test("does not downgrade prereleases or replace stable with same-core prerelease", async () => {
  assert.deepEqual(await checkForUpdate({ platform: "linux", currentVersion: "0.2.1-beta.10", repository: "x/y", channel: "beta", fetchImpl: fetchReleases([release("0.2.1-beta.2")]) }), { available: false, currentVersion: "0.2.1-beta.10" });
  assert.deepEqual(await checkForUpdate({ platform: "linux", currentVersion: "0.2.1", repository: "x/y", channel: "beta", fetchImpl: fetchReleases([release("0.2.1-beta.99")]) }), { available: false, currentVersion: "0.2.1" });
});

test("uses SemVer numeric, lexical and identifier-length precedence", async () => {
  const candidates = [release("0.2.1-beta"), release("0.2.1-beta.2"), release("0.2.1-beta.11"), release("0.2.1-rc.1")];
  const result = await checkForUpdate({ platform: "linux", currentVersion: "0.2.1-beta", repository: "x/y", channel: "beta", fetchImpl: fetchReleases(candidates) });
  assert.equal(result.version, "0.2.1-rc.1");
});

test("binds asset lookup to the exact prerelease version", async () => {
  await assert.rejects(checkForUpdate({ platform: "linux", currentVersion: "0.2.1-beta.1", repository: "x/y", channel: "beta", fetchImpl: fetchReleases([release("0.2.1-beta.2", { assetsVersion: "0.2.1" })]) }), /missing verified assets/);
});

test("rejects malformed and leading-zero prerelease identifiers", async () => {
  for (const version of ["0.2.1-beta..1", "0.2.1-01", "0.2.1-beta+build", "0.2.1-"]) {
    await assert.rejects(checkForUpdate({ platform: "linux", currentVersion: version, repository: "x/y", channel: "beta", fetchImpl: fetchReleases([]) }), /expected semver/, version);
  }
});

test("does not cross stable and prerelease channels", async () => {
  const beta = [{ tag_name: "v1.0.0", prerelease: true, draft: false, assets: [{ name: "nowplaying-v1.0.0.tar.gz" }, { name: "SHA256SUMS" }] }];
  assert.deepEqual(await checkForUpdate({ platform: "linux", currentVersion: "0.1.0", repository: "x/y", channel: "stable", fetchImpl: fetchReleases(beta) }), { available: false, currentVersion: "0.1.0" });
});

test("rejects missing assets and sanitized API failures", async () => {
  await assert.rejects(checkForUpdate({ platform: "linux", currentVersion: "0.1.0", repository: "x/y", fetchImpl: fetchReleases([], 403) }), /update check failed \(403\)/);
  await assert.rejects(checkForUpdate({ platform: "linux", currentVersion: "0.1.0", repository: "x/y", fetchImpl: fetchReleases([{ tag_name: "v0.2.0", prerelease: false, draft: false, assets: [] }]) }), /missing verified assets/);
});

test("caps the release list response and passes a timeout signal", async () => {
  let seen;
  const huge = { ok: true, status: 200, headers: new Headers({ "content-length": String(5 * 1024 * 1024) }), text: async () => { throw new Error("must not read"); } };
  await assert.rejects(checkForUpdate({ platform: "linux", currentVersion: "0.1.0", repository: "x/y", fetchImpl: async (_url, options) => { seen = options.signal; return huge; } }), /update check response is too large/);
  assert.ok(seen instanceof AbortSignal);
});

test("reports malformed release JSON as invalid releases", async () => {
  const response = { ok: true, status: 200, text: async () => "{not json" };
  await assert.rejects(checkForUpdate({ platform: "linux", currentVersion: "0.1.0", repository: "x/y", fetchImpl: async () => response }), /invalid releases/);
});

test("parses crafted tags in linear time and skips malformed releases", async () => {
  const crafted = [`v0.0.0-0.${"--.".repeat(40)}`, `v0.0.0--${"-".repeat(120)}!`, `v0.0.0-${"a-".repeat(5000)}!`];
  const started = performance.now();
  const result = await checkForUpdate({ platform: "linux", currentVersion: "0.1.0", repository: "x/y", channel: "beta", fetchImpl: fetchReleases([...crafted.map((tag) => ({ ...release("0.2.0"), tag_name: tag })), release("0.2.0")]) });
  // Exponential backtracking takes minutes on these inputs; linear takes milliseconds.
  assert.ok(performance.now() - started < 2000, "version parsing must not backtrack");
  assert.equal(result.version, "0.2.0");
});

test("rejects invalid prerelease identifiers and overlong versions", async () => {
  for (const currentVersion of ["0.1.0-01", "0.1.0-a..b", "0.1.0-", "0.1.0-a.", `0.1.0-${"a".repeat(130)}`]) {
    await assert.rejects(checkForUpdate({ platform: "linux", currentVersion, repository: "x/y", fetchImpl: fetchReleases([]) }), /expected semver/, currentVersion);
  }
  assert.deepEqual(await checkForUpdate({ platform: "linux", currentVersion: "0.1.0-0.a-b.1", repository: "x/y", fetchImpl: fetchReleases([]) }), { available: false, currentVersion: "0.1.0-0.a-b.1" });
});

test("Windows installs update from the Windows bundle, not the source tarball (#373)", async () => {
  const winAssets = [{ name: "nowplaying-v0.2.0.tar.gz", url: "tar" }, { name: "nowplaying-v0.2.0-windows-x64.zip", url: "zip" }, { name: "SHA256SUMS", url: "sums" }];
  const result = await checkForUpdate({ platform: "win32", currentVersion: "0.1.0", repository: "x/y", fetchImpl: fetchReleases([{ tag_name: "v0.2.0", prerelease: false, draft: false, html_url: "release", assets: winAssets }]) });
  assert.equal(result.assetName, "nowplaying-v0.2.0-windows-x64.zip");
  assert.equal(result.assetUrl, "zip");
  const linux = await checkForUpdate({ platform: "linux", currentVersion: "0.1.0", repository: "x/y", fetchImpl: fetchReleases([{ tag_name: "v0.2.0", prerelease: false, draft: false, html_url: "release", assets: winAssets }]) });
  assert.equal(linux.assetUrl, "tar");
});

test("a Windows install refuses a release that only has the tarball", async () => {
  await assert.rejects(checkForUpdate({ platform: "win32", currentVersion: "0.1.0", repository: "x/y", fetchImpl: fetchReleases([{ tag_name: "v0.2.0", prerelease: false, draft: false, assets }]) }), /missing verified assets/);
});

test("updateAssetName maps versions to the published names", () => {
  assert.equal(updateAssetName("v1.2.3", "win32"), "nowplaying-v1.2.3-windows-x64.zip");
  assert.equal(updateAssetName("1.2.3-beta.1", "darwin"), "nowplaying-v1.2.3-beta.1.tar.gz");
  assert.throws(() => updateAssetName("../x", "win32"), /semver/);
});
