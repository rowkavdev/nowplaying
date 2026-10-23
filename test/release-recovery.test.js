import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyRecoveryRun, recoverRelease } from "../scripts/recover-release.js";
import { releaseAssetNames, verifyReleaseArtifacts } from "../scripts/release-artifacts.js";

const repository = "owner/nowplaying", tag = "v0.2.1", runId = 40020000000, sha = "a".repeat(40);
function fixture({ run = {}, jobs, ref, attestationFailure = false } = {}) {
  const calls = [];
  const state = { id: runId, path: ".github/workflows/release.yml", repository: { full_name: repository }, event: "workflow_dispatch", head_branch: tag, head_sha: sha, status: "completed", ...run };
  const normalJobs = [
    { name: "verify", conclusion: "success" }, { name: "windows", conclusion: "success" },
    { name: "publish", conclusion: "failure", steps: [{ name: "Attest public-repository build provenance", conclusion: "success" }] },
  ];
  const gh = async args => {
    calls.push(args);
    if (args[0] === "attestation") {
      if (attestationFailure) throw new Error("artifact attestation verification failed");
      return "verified";
    }
    const endpoint = args.at(-1);
    if (endpoint.endsWith(`/git/ref/tags/${tag}`)) return JSON.stringify(ref ?? { ref: `refs/tags/${tag}`, object: { type: "commit", sha } });
    if (endpoint.endsWith(`/git/tags/${"b".repeat(40)}`)) return JSON.stringify({ object: { type: "commit", sha } });
    if (endpoint.endsWith(`/actions/runs/${runId}`)) return JSON.stringify(state);
    assert.equal(endpoint, `repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`);
    assert.deepEqual(args.slice(0, 3), ["api", "--paginate", "--slurp"]);
    const allJobs = jobs ?? normalJobs;
    return JSON.stringify([{ jobs: allJobs.slice(0, 1) }, { jobs: allJobs.slice(1) }]);
  };
  return { calls, gh, verify: () => verifyRecoveryRun({ repository, tag, runId, gh }) };
}

test("recovery accepts the completed original tag build despite its publish-only failure", async () => {
  assert.deepEqual(await fixture().verify(), { tag, runId, sha });
  const annotated = fixture({ ref: { ref: `refs/tags/${tag}`, object: { type: "tag", sha: "b".repeat(40) } } });
  assert.equal((await annotated.verify()).sha, sha);
});

test("recovery rejects a different workflow, repository, event, commit or tag", async () => {
  for (const run of [
    { path: ".github/workflows/beta.yml" }, { repository: { full_name: "other/project" } },
    { event: "pull_request" }, { head_sha: "c".repeat(40) }, { head_branch: "main" }, { id: runId + 1 },
  ]) await assert.rejects(fixture({ run }).verify(), /original repository|immutable tag/);
  await assert.rejects(fixture({ ref: { ref: "refs/heads/v0.2.1", object: { type: "commit", sha } } }).verify(), /tag ref/);
});

test("recovery requires finished builds and the original successful provenance step", async () => {
  await assert.rejects(fixture({ run: { status: "in_progress" } }).verify(), /must finish/);
  for (const jobs of [
    [], [{ name: "verify", conclusion: "success" }],
    [{ name: "verify", conclusion: "success" }, { name: "windows", conclusion: "failure" }],
    [{ name: "verify", conclusion: "failure" }, { name: "windows", conclusion: "success" }],
    [{ name: "verify", conclusion: "success" }, { name: "windows", conclusion: "success" }, { name: "publish", steps: [] }],
  ]) await assert.rejects(fixture({ jobs }).verify(), /job must succeed|attestation must succeed/);
});

test("recovery verifies original binary provenance and recomputes all four checksums before publishing", async t => {
  const directory = await mkdtemp(join(tmpdir(), "np-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = releaseAssetNames(tag);
  for (const name of names) await writeFile(join(directory, name), `original ${name}`);
  await writeFile(join(directory, "SHA256SUMS"), "source-only artifact manifest\n");
  const f = fixture();
  let published = false;
  await recoverRelease({ directory, repository, tag, runId, gh: f.gh, publish: async options => {
    assert.equal(options.sha, sha, "use the original tag commit instead of the recovery workflow's main commit");
    await verifyReleaseArtifacts(directory, tag);
    published = true;
  } });
  assert.equal(published, true);
  const attestations = f.calls.filter(call => call[0] === "attestation");
  assert.equal(attestations.length, 3);
  for (const args of attestations) {
    assert.ok(!args[2].endsWith(".spdx.json"));
    assert.equal(args[args.indexOf("--source-digest") + 1], sha);
    assert.equal(args[args.indexOf("--source-ref") + 1], `refs/tags/${tag}`);
    assert.equal(args[args.indexOf("--signer-workflow") + 1], `${repository}/.github/workflows/release.yml`);
  }
  assert.equal((await readFile(join(directory, "SHA256SUMS"), "utf8")).trim().split("\n").length, 4);
  const failing = fixture({ attestationFailure: true });
  published = false;
  await assert.rejects(recoverRelease({ directory, repository, tag, runId, gh: failing.gh, publish: async () => { published = true; } }), /attestation verification failed/);
  assert.equal(published, false);
});

test("recovery workflow runs on protected main and downloads exact original run artifacts without rebuilding", () => {
  const workflow = readFileSync(new URL("../.github/workflows/recover-release.yml", import.meta.url), "utf8");
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: release/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /attestations: read/);
  assert.doesNotMatch(workflow, /attestations: write|id-token: write|npm |build-windows|git tag/);
  assert.equal((workflow.match(/actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/g) ?? []).length, 2);
  assert.equal((workflow.match(/run-id: \$\{\{ inputs.run_id \}\}/g) ?? []).length, 2);
  assert.equal((workflow.match(/github-token: \$\{\{ github.token \}\}/g) ?? []).length, 2);
  assert.match(workflow, /name: release-\$\{\{ inputs.tag \}\}/);
  assert.match(workflow, /name: release-windows-\$\{\{ inputs.tag \}\}/);
  assert.ok(workflow.indexOf("recover-release.js verify") < workflow.indexOf("actions/download-artifact"));
  assert.ok(workflow.lastIndexOf("actions/download-artifact") < workflow.indexOf("recover-release.js publish"));
});
