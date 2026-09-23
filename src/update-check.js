import { readBoundedBytes, timeoutSignal } from "./bounded-response.js";

const MAX_RELEASES_BYTES = 4 * 1024 * 1024;
const CHECK_TIMEOUT_MS = 30 * 1000;
// Linear-time SemVer parsing: one unambiguous pattern for the shape, then a
// per-identifier check. (The single-regex form backtracked exponentially on
// crafted tags, and tags come from the release API.)
const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const MAX_VERSION_LENGTH = 128;

export async function checkForUpdate({ currentVersion, repository, token, channel = "stable", fetchImpl = globalThis.fetch, timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  const current = parseVersion(currentVersion);
  if (!["stable", "beta"].includes(channel)) throw new TypeError("channel: expected stable or beta");
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new TypeError("repository: expected owner/name");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl: expected a function");
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases`, { headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...signalOption(timeoutMs) });
  if (!response.ok) throw new Error(`update check failed (${response.status})`);
  const releases = await readReleases(response);
  if (!Array.isArray(releases)) throw new TypeError("update check returned invalid releases");
  const candidates = releases.filter((release) => release && !release.draft && typeof release.tag_name === "string" && Boolean(release.prerelease) === (channel === "beta"))
    .map((release) => ({ release, version: tryParseVersion(release.tag_name) }))
    .filter((candidate) => candidate.version !== null)
    .sort((a, b) => compareVersion(b.version, a.version));
  const latest = candidates[0];
  if (!latest || compareVersion(latest.version, current) <= 0) return Object.freeze({ available: false, currentVersion: current.normalized });
  const asset = latest.release.assets?.find((value) => value.name === `nowplaying-v${latest.version.normalized}.tar.gz`);
  const checksum = latest.release.assets?.find((value) => value.name === "SHA256SUMS");
  if (!asset || !checksum) throw new Error("update release is missing verified assets");
  return Object.freeze({ available: true, currentVersion: current.normalized, version: latest.version.normalized, releaseUrl: latest.release.html_url, assetUrl: asset.url, checksumUrl: checksum.url });
}

function parseVersion(value) {
  if (typeof value !== "string" || value.length > MAX_VERSION_LENGTH) throw new TypeError("version: expected semver");
  const match = VERSION_PATTERN.exec(value);
  if (!match) throw new TypeError("version: expected semver");
  const prerelease = match[4]?.split(".") ?? [];
  if (!prerelease.every(validIdentifier)) throw new TypeError("version: expected semver");
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease, normalized: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ""}` };
}

// A malformed tag on one release shouldn't stop update checks altogether.
function tryParseVersion(value) {
  try { return parseVersion(value); } catch { return null; }
}

function validIdentifier(part) {
  if (!part) return false;
  if (/^\d+$/.test(part)) return part === "0" || part[0] !== "0";
  return /^[0-9A-Za-z-]+$/.test(part);
}

function compareVersion(a, b) {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core) return core;
  if (!a.prerelease.length || !b.prerelease.length) return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === right) continue;
    const leftNumber = /^\d+$/.test(left);
    const rightNumber = /^\d+$/.test(right);
    if (leftNumber && rightNumber) return Number(left) - Number(right);
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

function signalOption(ms) {
  const signal = timeoutSignal(ms);
  return signal ? { signal } : {};
}

async function readReleases(response) {
  if (!response.body && typeof response.arrayBuffer !== "function" && typeof response.text !== "function") return response.json();
  const bytes = await readBoundedBytes(response, MAX_RELEASES_BYTES, "update check response");
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new TypeError("update check returned invalid releases"); }
}
