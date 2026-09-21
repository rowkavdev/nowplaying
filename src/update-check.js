const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export async function checkForUpdate({ currentVersion, repository, token, fetchImpl = globalThis.fetch } = {}) {
  const current = parseVersion(currentVersion);
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new TypeError("repository: expected owner/name");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl: expected a function");
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases`, {
    headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) throw new Error(`update check failed (${response.status})`);
  const releases = await response.json();
  if (!Array.isArray(releases)) throw new TypeError("update check returned invalid releases");
  const candidates = releases.filter((release) => release && !release.draft && typeof release.tag_name === "string")
    .map((release) => ({ release, version: parseVersion(release.tag_name) }))
    .filter(({ version }) => version.prerelease === current.prerelease)
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
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: Boolean(match[4]), normalized: `${match[1]}.${match[2]}.${match[3]}` };
}
function compareVersion(a, b) { return a.major - b.major || a.minor - b.minor || a.patch - b.patch; }
