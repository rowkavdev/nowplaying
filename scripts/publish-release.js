import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { verifyReleaseArtifacts } from "./release-artifacts.js";

const exec = promisify(execFile);
async function runGh(args) { return (await exec("gh", args, { maxBuffer: 4 * 1024 * 1024 })).stdout; }

export async function publishRelease({ directory = process.cwd(), tag, repository, sha, gh = runGh } = {}) {
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new TypeError("release repository must be owner/name");
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha)) throw new TypeError("release commit must be a full SHA");
  const files = await verifyReleaseArtifacts(directory, tag);
  // REST's release-by-tag endpoint omits drafts even with owner access.
  // gh release view resolves authenticated drafts; pin subsequent fresh reads
  // to its numeric ID so a deleted/recreated release cannot change ownership.
  const { databaseId } = JSON.parse(await gh(["release", "view", tag, "--repo", repository, "--json", "databaseId"]));
  if (!Number.isSafeInteger(databaseId) || databaseId <= 0) throw new Error("release lookup returned an invalid release ID");
  const endpoint = `repos/${repository}/releases/${databaseId}`;
  async function draftRelease() {
    const release = JSON.parse(await gh(["api", endpoint]));
    if (release.tag_name !== tag || release.draft !== true || release.prerelease !== false) throw new Error("refusing to change a published release or a prerelease");
    if (!Array.isArray(release.assets) || release.assets.some(asset => !files.includes(asset.name))) throw new Error("draft release contains unexpected assets");
    return release;
  }
  const release = await draftRelease();
  const commit = JSON.parse(await gh(["api", `repos/${repository}/commits/${tag}`]));
  if (commit.sha?.toLowerCase() !== sha.toLowerCase()) throw new Error("release tag no longer points at the verified commit");
  const temporary = await mkdtemp(join(tmpdir(), "nowplaying-release-"));
  try {
    // Retry partial uploads only when the existing draft bytes are identical.
    // Never use --clobber: published assets cannot be replaced by a rerun or
    // by someone publishing this draft while the upload is in progress.
    const existing = release.assets.map(asset => asset.name);
    if (existing.length) {
      await gh(["release", "download", tag, "--repo", repository, "--dir", temporary, ...existing.flatMap(name => ["--pattern", name])]);
      for (const name of existing) {
        if (!(await readFile(join(temporary, name))).equals(await readFile(join(directory, name)))) throw new Error(`draft asset differs from the verified build: ${name}`);
      }
    }
    const missing = files.filter(name => !existing.includes(name));
    if (missing.length) await gh(["release", "upload", tag, "--repo", repository, ...missing.map(name => join(directory, name))]);
    await rm(temporary, { recursive: true, force: true });
    // Verify the downloadable bytes, including the checksum file itself,
    // before making the release visible or marking it Latest.
    const downloaded = await mkdtemp(join(tmpdir(), "nowplaying-release-download-"));
    try {
      await gh(["release", "download", tag, "--repo", repository, "--dir", downloaded, ...files.flatMap(name => ["--pattern", name])]);
      await verifyReleaseArtifacts(downloaded, tag);
      for (const name of files) {
        if (!(await readFile(join(downloaded, name))).equals(await readFile(join(directory, name)))) throw new Error(`downloaded release asset differs: ${name}`);
      }
      await draftRelease();
      const current = JSON.parse(await gh(["api", `repos/${repository}/commits/${tag}`]));
      if (current.sha?.toLowerCase() !== sha.toLowerCase()) throw new Error("release tag changed during upload");
      await gh(["release", "edit", tag, "--repo", repository, "--draft=false", "--prerelease=false", "--latest"]);
    } finally { await rm(downloaded, { recursive: true, force: true }); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await publishRelease({ tag: process.env.GITHUB_REF_NAME, repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA });
}
