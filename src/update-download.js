import { createHash } from "node:crypto";

export async function downloadVerifiedUpdate({ update, token, fetchImpl = globalThis.fetch } = {}) {
  if (!update?.available || typeof update.assetUrl !== "string" || typeof update.checksumUrl !== "string") throw new TypeError("update: expected an available update");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl: expected a function");
  const headers = { Accept: "application/octet-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const [assetResponse, checksumResponse] = await Promise.all([
    fetchImpl(update.assetUrl, { headers }),
    fetchImpl(update.checksumUrl, { headers }),
  ]);
  if (!assetResponse.ok || !checksumResponse.ok) throw new Error("update download failed");
  const [bytes, checksumText] = await Promise.all([assetResponse.arrayBuffer(), checksumResponse.text()]);
  const archive = new Uint8Array(bytes);
  if (archive.byteLength < 1 || archive.byteLength > 100 * 1024 * 1024) throw new Error("update archive size is invalid");
  const filename = `nowplaying-v${update.version}.tar.gz`;
  const expected = parseChecksum(checksumText, filename);
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) throw new Error("update checksum mismatch");
  return Object.freeze({ filename, bytes: archive, sha256: actual, version: update.version });
}

function parseChecksum(text, filename) {
  if (typeof text !== "string" || text.length > 64 * 1024) throw new Error("invalid checksum manifest");
  const matches = text.split(/\r?\n/).map((line) => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).filter(Boolean).filter((match) => match[2] === filename);
  if (matches.length !== 1) throw new Error("invalid checksum manifest");
  return matches[0][1];
}
