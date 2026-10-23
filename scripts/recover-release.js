import { execFile } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { releaseAssetNames, verifyReleaseArtifacts } from "./release-artifacts.js";
import { publishRelease } from "./publish-release.js";

const exec = promisify(execFile);
async function runGh(args) { return (await exec("gh", args, { maxBuffer: 8 * 1024 * 1024 })).stdout; }

export async function verifyRecoveryRun({ repository, tag, runId, gh = runGh } = {}) {
  releaseAssetNames(tag);
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new TypeError("recovery repository must be owner/name");
  if (!/^[1-9]\d*$/.test(String(runId)) || !Number.isSafeInteger(Number(runId))) throw new TypeError("recovery run ID must be a positive integer");
  const api = async endpoint => JSON.parse(await gh(["api", `repos/${repository}/${endpoint}`]));
  const ref = await api(`git/ref/tags/${tag}`);
  if (ref.ref !== `refs/tags/${tag}`) throw new Error("recovery tag ref does not match");
  let object = ref.object;
  for (let depth = 0; object?.type === "tag" && depth < 5; depth++) {
    if (!/^[a-f0-9]{40}$/i.test(object.sha ?? "")) throw new Error("recovery tag object is invalid");
    object = (await api(`git/tags/${object.sha}`)).object;
  }
  if (object?.type !== "commit" || !/^[a-f0-9]{40}$/i.test(object.sha ?? "")) throw new Error("recovery tag must resolve to a commit");
  const sha = object.sha.toLowerCase();
  const run = await api(`actions/runs/${runId}`);
  if (run.id !== Number(runId) || run.path !== ".github/workflows/release.yml" || run.repository?.full_name !== repository || !["push", "workflow_dispatch"].includes(run.event)) throw new Error("recovery requires the original repository's release.yml run");
  if (run.head_branch !== tag || run.head_sha?.toLowerCase() !== sha) throw new Error("release run does not match the immutable tag commit");
  if (run.status !== "completed") throw new Error("original release run must finish before recovery");
  const pages = JSON.parse(await gh(["api", "--paginate", "--slurp", `repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`]));
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.jobs))) throw new Error("release run jobs response is invalid");
  const jobs = pages.flatMap(page => page.jobs);
  for (const name of ["verify", "windows"]) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].conclusion !== "success") throw new Error(`original release ${name} job must succeed`);
  }
  // Recovery reuses the original provenance instead of issuing new attestations
  // from main. Do not race or bypass the original tag's attestation step.
  const publish = jobs.filter(job => job.name === "publish");
  if (publish.length !== 1 || !publish[0].steps?.some(step => step.name === "Attest public-repository build provenance" && step.conclusion === "success")) throw new Error("original release provenance attestation must succeed");
  return Object.freeze({ tag, sha, runId: Number(runId) });
}

export async function recoverRelease({ directory, repository, tag, runId, gh = runGh, publish = publishRelease } = {}) {
  const verified = await verifyRecoveryRun({ repository, tag, runId, gh });
  const names = releaseAssetNames(tag);
  // Verify the three artifacts attested by the original tag workflow, pinned
  // to that workflow, source tag and source commit. No build runs in recovery.
  for (const name of names.filter(name => !name.endsWith(".spdx.json"))) {
    await gh(["attestation", "verify", join(directory, name), "--repo", repository,
      "--signer-workflow", `${repository}/.github/workflows/release.yml`, "--source-ref", `refs/tags/${tag}`, "--source-digest", verified.sha]);
  }
  const checksums = [];
  for (const name of names) {
    const bytes = await readFile(join(directory, name));
    if (!bytes.length) throw new Error(`empty release asset: ${name}`);
    checksums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`);
  }
  await writeFile(join(directory, "SHA256SUMS"), checksums.join(""));
  await verifyReleaseArtifacts(directory, tag);
  await publish({ directory, repository, tag, sha: verified.sha, gh });
  return verified;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = { repository: process.env.GITHUB_REPOSITORY, tag: process.env.RECOVERY_TAG, runId: process.env.RECOVERY_RUN_ID };
  if (process.argv[2] === "verify") {
    const result = await verifyRecoveryRun(options);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `sha=${result.sha}\n`);
    console.log(`Verified ${result.tag} at ${result.sha} from release run ${result.runId}`);
  } else if (process.argv[2] === "publish") {
    await recoverRelease({ ...options, directory: resolve(process.env.RECOVERY_ARTIFACTS ?? "release-artifacts") });
  } else throw new Error("usage: recover-release.js verify|publish");
}
