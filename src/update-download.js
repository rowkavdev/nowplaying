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
  // GitHub's API always 302s asset requests to its signed CDN, so the two
  // asset fetches must follow; the SHA256SUMS check below is the integrity
  // anchor, and the final URL is pinned to GitHub's asset CDN origins.
  const options = { headers, redirect: "follow", ...(signal ? { signal } : {}) };
  const responses = [];
  let fetchFailed = false;
  const fetchResponse = async (url) => {
    const response = await fetchImpl(url, options);
    if (fetchFailed) cancelResponse(response);
    else responses.push(response);
    return response;
  };
  let assetResponse, checksumResponse;
  try {
    [assetResponse, checksumResponse] = await Promise.all([
      fetchResponse(assetUrl),
      fetchResponse(checksumUrl),
    ]);
  } catch (error) {
    fetchFailed = true;
    for (const response of responses) cancelResponse(response);
    throw error;
  }
  try {
    if (!assetResponse.ok || !checksumResponse.ok) throw new Error("update download failed");
    assertFinalUrl(assetResponse, assetUrl);
    assertFinalUrl(checksumResponse, checksumUrl);
  } catch (error) {
    // Both responses still own unread bodies. Cleanup must not delay or replace rejection.
    for (const response of [assetResponse, checksumResponse]) {
      cancelResponse(response);
    }
    throw error;
  }
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

function cancelResponse(response) {
  try { Promise.resolve(response.body?.cancel?.()).catch(() => {}); } catch {}
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

// After following, the bytes may come from the requested API URL itself or
// from GitHub's release-asset CDN, nowhere else. Adapters that don't report a
// final URL can't be checked; the checksum below still gates what installs.
const ASSET_CDN_ORIGINS = new Set([
  "https://objects.githubusercontent.com",
  "https://release-assets.githubusercontent.com",
]);

function assertFinalUrl(response, requested) {
  if (!response.url) return;
  let url;
  try { url = new URL(response.url); } catch { throw new Error("update download redirect was rejected"); }
  if (url.toString() === requested) return;
  if (ASSET_CDN_ORIGINS.has(url.origin) && !url.username && !url.password) return;
  throw new Error("update download redirect was rejected");
}

function parseChecksum(text, filename) {
  if (typeof text !== "string" || text.length > 64 * 1024) throw new Error("invalid checksum manifest");
  const matches = text.split(/\r?\n/).map((line) => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line)).filter(Boolean).filter((match) => match[2] === filename);
  if (matches.length !== 1) throw new Error("invalid checksum manifest");
  return matches[0][1];
}
