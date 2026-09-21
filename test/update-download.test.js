import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { downloadVerifiedUpdate } from "../src/update-download.js";

const bytes = new TextEncoder().encode("release archive");
const digest = createHash("sha256").update(bytes).digest("hex");
const update = { available: true, version: "0.2.0", assetUrl: "asset", checksumUrl: "sums" };
function fetchPair(manifest = `${digest}  nowplaying-v0.2.0.tar.gz\n`) { return async (url) => url === "asset" ? { ok: true, arrayBuffer: async () => bytes.buffer } : { ok: true, text: async () => manifest }; }

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
