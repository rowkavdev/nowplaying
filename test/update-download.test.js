import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { downloadVerifiedUpdate } from "../src/update-download.js";

const bytes = new TextEncoder().encode("release archive");
const digest = createHash("sha256").update(bytes).digest("hex");
const assetUrl = "https://api.github.com/repos/rowkav09/nowplaying/releases/assets/1";
const checksumUrl = "https://api.github.com/repos/rowkav09/nowplaying/releases/assets/2";
const update = { available: true, version: "0.2.0", assetUrl, checksumUrl };
function fetchPair(manifest = `${digest}  nowplaying-v0.2.0.tar.gz\n`) {
  return async (url, options) => {
    assert.equal(options.redirect, "error");
    return url === assetUrl
      ? { ok: true, url: assetUrl, arrayBuffer: async () => bytes.buffer }
      : { ok: true, url: checksumUrl, text: async () => manifest };
  };
}

test("downloads and verifies the exact release archive", async () => {
  const result = await downloadVerifiedUpdate({ update, token: "secret", fetchImpl: fetchPair() });
  assert.equal(result.filename, "nowplaying-v0.2.0.tar.gz");
  assert.equal(result.sha256, digest);
  assert.deepEqual(result.bytes, bytes);
});

test("rejects mismatches and ambiguous manifests", async () => {
  await assert.rejects(downloadVerifiedUpdate({ update, fetchImpl: fetchPair(`${"0".repeat(64)}  nowplaying-v0.2.0.tar.gz\n`) }), /checksum mismatch/);
  await assert.rejects(downloadVerifiedUpdate({ update, fetchImpl: fetchPair(`${digest}  nowplaying-v0.2.0.tar.gz\n${digest}  nowplaying-v0.2.0.tar.gz\n`) }), /invalid checksum manifest/);
});

test("rejects asset and checksum URLs outside the GitHub API origin", async () => {
  for (const field of ["assetUrl", "checksumUrl"]) {
    await assert.rejects(downloadVerifiedUpdate({
      update: { ...update, [field]: "https://attacker.example/update" },
      token: "secret",
      fetchImpl: async () => { throw new Error("must not fetch"); },
    }), new RegExp(`update\\.${field}`));
  }
});

test("rejects followed redirects even if fetch returns success", async () => {
  const fetchImpl = async (url) => url === assetUrl
    ? { ok: true, url: "https://objects.githubusercontent.com/redirected", arrayBuffer: async () => bytes.buffer }
    : { ok: true, url: checksumUrl, text: async () => `${digest}  nowplaying-v0.2.0.tar.gz\n` };
  await assert.rejects(downloadVerifiedUpdate({ update, fetchImpl }), /redirect was rejected/);
});

test("rejects an oversized archive before hashing it", async () => {
  const fetchImpl = async (url) => url === assetUrl
    ? { ok: true, url: assetUrl, headers: new Headers({ "content-length": String(101 * 1024 * 1024) }), arrayBuffer: async () => { throw new Error("must not buffer"); } }
    : { ok: true, url: checksumUrl, text: async () => `${digest}  nowplaying-v0.2.0.tar.gz\n` };
  await assert.rejects(downloadVerifiedUpdate({ update, fetchImpl }), /update archive is too large/);
});

test("rejects an oversized checksum manifest", async () => {
  await assert.rejects(downloadVerifiedUpdate({ update, fetchImpl: fetchPair("x".repeat(65 * 1024)) }), /checksum manifest is too large/);
});

test("passes an abort signal so a stalled download times out", async () => {
  let seen;
  const fetchImpl = async (url, options) => { seen = options.signal; return fetchPair()(url, options); };
  await downloadVerifiedUpdate({ update, fetchImpl });
  assert.ok(seen instanceof AbortSignal);
});
