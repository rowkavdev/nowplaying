import { createHash } from "node:crypto";
import { readBoundedBytes, timeoutSignal } from "./bounded-response.js";
import { updateAssetName } from "./update-check.js";

const GITHUB_API_ORIGIN = "https://api.github.com";
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 64 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export async function downloadVerifiedUpdate({ update, token, fetchImpl = globalThis.fetch, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  if (!update?.available || typeof update.assetUrl !== "string" || typeof update.checksumUrl !== "string") throw new TypeError("update: expected an available update");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl: expected a function");
  const assetUrl = trustedAssetUrl(update.assetUrl, "assetUrl");
  const checksumUrl = trustedAssetUrl(update.checksumUrl, "checksumUrl");
  const headers = { Accept: "application/octet-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const signal = timeoutSignal(timeoutMs);
  const options = { headers, redirect: "error", ...(signal ? { signal } : {}) };
  const [assetResponse, checksumResponse] = await Promise.all([
    fetchImpl(assetUrl, options),
    fetchImpl(checksumUrl, options),
  ]);
  if (!assetResponse.ok || !checksumResponse.ok) throw new Error("update download failed");
  assertFinalUrl(assetResponse, assetUrl);
  assertFinalUrl(checksumResponse, checksumUrl);
  const [archive, checksumBytes] = await Promise.all([
    readBoundedBytes(assetResponse, MAX_ARCHIVE_BYTES, "update archive"),
    readBoundedBytes(checksumResponse, MAX_CHECKSUM_BYTES, "checksum manifest"),
  ]);
  if (archive.byteLength < 1) throw new Error("update archive size is invalid");
  const checksumText = new TextDecoder().decode(checksumBytes);
  const filename = expectedAssetName(update);
  const expected = parseChecksum(checksumText, filename);
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) throw new Error("update checksum mismatch");
  return Object.freeze({ filename, bytes: archive, sha256: actual, version: update.version });
}

// Only the two names the release workflow publishes for this exact version are
// accepted, whatever the update object says; older callers default to the tarball.
function expectedAssetName(update) {
  const allowed = [updateAssetName(update.version, "linux"), updateAssetName(update.version, "win32")];
  const name = update.assetName ?? allowed[0];
  if (!allowed.includes(name)) throw new TypeError("update.assetName: unexpected release asset");
  return name;
}

function trustedAssetUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`update.${name}: expected a GitHub API URL`); }
  if (url.origin !== GITHUB_API_ORIGIN || url.username || url.password || url.hash) {
    throw new TypeError(`update.${name}: expected a GitHub API URL`);
  }
  return url.toString();
}

function assertFinalUrl(response, requested) {
  if (!response.url) return;
  if (new URL(response.url).toString() !== requested) throw new Error("update download redirect was rejected");
}

function parseChecksum(text, filename) {
  if (typeof text !== "string" || text.length > 64 * 1024) throw new Error("invalid checksum manifest");
  const matches = text.split(/\r?\n/).map((line) => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).filter(Boolean).filter((match) => match[2] === filename);
  if (matches.length !== 1) throw new Error("invalid checksum manifest");
  return matches[0][1];
}
