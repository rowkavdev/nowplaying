import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { packSourceRelease } from "../scripts/pack-source-release.js";
import { checkSourceRelease } from "../scripts/check-source-release.js";

const repository = fileURLToPath(new URL("..", import.meta.url));
const gnuTar = (() => { try { return execFileSync("tar", ["--version"], { encoding: "utf8" }).includes("GNU tar"); } catch { return false; } })();

test("source release exports and CLI work from an independently extracted archive", { skip: !gnuTar }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "np-source-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ["src", "scripts", "assets", "docs", "LICENSE", "NOTICE", "README.md", "CONTRIBUTING.md", "SECURITY.md", "package.json", "package-lock.json"]) await cp(join(repository, name), join(directory, name), { recursive: true });
  execFileSync(process.execPath, [join(repository, "scripts", "build.js")], { cwd: directory });
  const version = JSON.parse(await readFile(join(directory, "package.json"), "utf8")).version;
  await mkdir(join(directory, "dist", "windows"));
  await writeFile(join(directory, "dist", "windows", "unrelated-bundle.zip"), "must not ship in source");
  const archive = await packSourceRelease({ root: directory, tag: `v${version}` });
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
  assert.match(entries, /^docs\/updates\.md$/m);
  assert.doesNotMatch(entries, /dist\/windows/);
  const first = await readFile(archive);
  await packSourceRelease({ root: directory, tag: `v${version}` });
  assert.deepEqual(await readFile(archive), first, "unchanged source must produce identical archive bytes");
  const installDependencies = extracted => symlink(join(repository, "node_modules"), join(extracted, "node_modules"), "junction");
  assert.equal(await checkSourceRelease({ archive, installDependencies }), version);
  await assert.rejects(packSourceRelease({ root: directory, tag: "v99.99.99" }), /version does not match/);
  // Reproduce the previous workflow payload: package.json claimed src/ and
  // scripts/ entrypoints that only existed under dist/ or were omitted.
  execFileSync("tar", ["-czf", archive, "dist", "LICENSE", "README.md", "package.json"], { cwd: directory });
  await assert.rejects(checkSourceRelease({ archive, installDependencies }), /Cannot find module|ERR_MODULE_NOT_FOUND/);
});
