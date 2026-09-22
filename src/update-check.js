const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

export async function checkForUpdate({ currentVersion, repository, token, channel = "stable", fetchImpl = globalThis.fetch } = {}) {
  const current = parseVersion(currentVersion);
  if (!["stable", "beta"].includes(channel)) throw new TypeError("channel: expected stable or beta");
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new TypeError("repository: expected owner/name");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl: expected a function");
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases`, { headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!response.ok) throw new Error(`update check failed (${response.status})`);
  const releases = await response.json();
  if (!Array.isArray(releases)) throw new TypeError("update check returned invalid releases");
  const candidates = releases.filter((release) => release && !release.draft && typeof release.tag_name === "string" && Boolean(release.prerelease) === (channel === "beta"))
    .map((release) => ({ release, version: parseVersion(release.tag_name) }))
    .sort((a, b) => compareVersion(b.version, a.version));
  const latest = candidates[0];
  if (!latest || compareVersion(latest.version, current) <= 0) return Object.freeze({ available: false, currentVersion: current.normalized });
  const asset = latest.release.assets?.find((value) => value.name === `nowplaying-v${latest.version.normalized}.tar.gz`);
  const checksum = latest.release.assets?.find((value) => value.name === "SHA256SUMS");
  if (!asset || !checksum) throw new Error("update release is missing verified assets");
  return Object.freeze({ available: true, currentVersion: current.normalized, version: latest.version.normalized, releaseUrl: latest.release.html_url, assetUrl: asset.url, checksumUrl: checksum.url });
}

function parseVersion(value) {
  if (typeof value !== "string") throw new TypeError("version: expected semver");
  const match = VERSION_PATTERN.exec(value);
  if (!match) throw new TypeError("version: expected semver");
  const prerelease = match[4]?.split(".") ?? [];
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease, normalized: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ""}` };
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
