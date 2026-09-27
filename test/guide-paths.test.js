import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { PATHS, checkDocs, runPath } from "../scripts/guide-paths.js";

for (const { id } of PATHS) {
  test(`guide path ${id} passes against the current tree`, async () => {
    const result = await runPath(id);
    assert.equal(result.status, "pass");
    for (const step of result.steps) assert.equal(step.status, "pass", JSON.stringify(step));
  });
}

test("a broken precondition fails the step that broke and skips the rest", async () => {
  // The windows-install path reads real shipped files; simulate drift by
  // pointing checkDocs at a doc whose claims disagree with a fresh run.
  const doc = await readFile("docs/guide-skeleton.md", "utf8");
  const dir = await mkdtemp(join(tmpdir(), "np-guide-doc-"));
  const drifted = join(dir, "drifted.md");
  await writeFile(drifted, doc.replace("Harness status: **pass**", "Harness status: **fail**"), "utf8");
  const result = await checkDocs(drifted);
  assert.equal(result.status, "fail");
  assert.ok(result.failures.some((failure) => failure.includes("doc claims fail")));
});

test("check-docs fails when a section loses its own status line", async () => {
  const doc = await readFile("docs/guide-skeleton.md", "utf8");
  const dir = await mkdtemp(join(tmpdir(), "np-guide-doc-"));
  const broken = join(dir, "no-status.md");
  const without = doc.replace(
    /Harness status: \*\*pass\*\* — verified by `node scripts\/guide-paths\.js run windows-install`\./,
    "",
  );
  assert.notEqual(without, doc);
  await writeFile(broken, without, "utf8");
  const result = await checkDocs(broken);
  assert.ok(result.failures.some((failure) => failure.includes("windows-install: missing harness status line")));
});

test("check-docs fails when a step reference moves out of its path section", async () => {
  const doc = await readFile("docs/guide-skeleton.md", "utf8");
  const dir = await mkdtemp(join(tmpdir(), "np-guide-doc-"));
  const moved = join(dir, "moved.md");
  let edited = doc.replace("3. Unchanged cards answer 304 to a matching ETag (harness step: cache-behavior).\n", "");
  assert.notEqual(edited, doc);
  edited += "\n## Appendix\n\nRetired step reference: harness step: cache-behavior.\n";
  await writeFile(moved, edited, "utf8");
  const result = await checkDocs(moved);
  assert.ok(result.failures.some((failure) => failure.includes("hosted-card: section never mentions harness step cache-behavior")),
    JSON.stringify(result.failures));
});

test("check-docs fails on a marker for a path the harness does not know", async () => {
  const doc = await readFile("docs/guide-skeleton.md", "utf8");
  const dir = await mkdtemp(join(tmpdir(), "np-guide-doc-"));
  const extra = join(dir, "extra.md");
  await writeFile(extra, doc + "\n## Bogus\n<!-- guide-path: bogus-path -->\nHarness status: **pass**\n", "utf8");
  const result = await checkDocs(extra);
  assert.ok(result.failures.some((failure) => failure.includes("bogus-path: guide-path marker for an unknown path")));
});

test("check-docs passes against the committed skeleton", async () => {
  const result = await checkDocs();
  assert.deepEqual(result.failures, []);
  assert.equal(result.status, "pass");
});

test("check-docs fails when a path or harness step disappears from the doc", async () => {
  const doc = await readFile("docs/guide-skeleton.md", "utf8");
  const dir = await mkdtemp(join(tmpdir(), "np-guide-doc-"));
  const noPath = join(dir, "no-path.md");
  await writeFile(noPath, doc.replace("<!-- guide-path: hosted-card -->", ""), "utf8");
  assert.ok((await checkDocs(noPath)).failures.some((failure) => failure.includes("hosted-card: missing guide-path marker")));
  const noStep = join(dir, "no-step.md");
  await writeFile(noStep, doc.replace("harness step: cache-behavior", "harness step: removed"), "utf8");
  assert.ok((await checkDocs(noStep)).failures.some((failure) => failure.includes("hosted-card: section never mentions harness step cache-behavior")));
});

test("CLI emits machine-visible JSONL with the failing step named", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["scripts/guide-paths.js", "run", "hosted-card"]);
  const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.at(-1).status, "pass");
  assert.ok(lines.some((line) => line.step === "cache-behavior" && line.status === "pass"));
  await assert.rejects(promisify(execFile)(process.execPath, ["scripts/guide-paths.js", "run", "bogus-path"]));
});
