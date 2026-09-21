export async function fetchReleaseDownloadStats({ repository, token, fetchImpl = fetch } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "")) throw new TypeError("repository: expected owner/name");
  if (typeof token !== "string" || token.length < 1) throw new TypeError("token: required for private release stats");
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2026-03-10" },
    redirect: "error",
  });
  if (!response.ok) throw new Error(`release stats unavailable (${response.status})`);
  const releases = await response.json();
  if (!Array.isArray(releases)) throw new TypeError("release stats: invalid response");
  return Object.freeze(releases.map((release) => Object.freeze({
    tag: String(release.tag_name),
    prerelease: Boolean(release.prerelease),
    publishedAt: release.published_at ?? null,
    assets: Object.freeze((release.assets || []).map((asset) => Object.freeze({
      name: String(asset.name),
      downloads: Number.isSafeInteger(asset.download_count) ? asset.download_count : 0,
      size: Number.isSafeInteger(asset.size) ? asset.size : 0,
    }))),
  })));
}

export function summarizeReleaseDownloads(releases) {
  const byAsset = {};
  let total = 0;
  for (const release of releases) for (const asset of release.assets) {
    total += asset.downloads;
    byAsset[asset.name] = (byAsset[asset.name] || 0) + asset.downloads;
  }
  return Object.freeze({ total, byAsset: Object.freeze(byAsset) });
}
