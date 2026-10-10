import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readPosixPackageInfo } from "../src/posix-package-info.js";

test("source checkouts have no fabricated provenance; all POSIX package markers are explicit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-posix-info-"));
  const appDirectory = pathToFileURL(`${dir}/`);
  assert.deepEqual(await readPosixPackageInfo(appDirectory), { packageType: "source", build: null });
  for (const packageType of ["portable", "deb", "rpm", "arch"]) {
    await writeFile(join(dir, "package-info.json"), JSON.stringify({ packageType }));
    assert.equal((await readPosixPackageInfo(appDirectory)).packageType, packageType);
  }
  await writeFile(join(dir, "package-info.json"), JSON.stringify({ packageType: "malicious-untrusted-value" }));
  await writeFile(join(dir, "build-info.json"), JSON.stringify({ version: "x", commitSha: "guess" }));
  assert.deepEqual(await readPosixPackageInfo(appDirectory), { packageType: "source", build: null });
});

test("POSIX build writer embeds exact full commit, build time and explicit unsigned channel", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-posix-build-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ version: "0.2.0" }));
  const script = fileURLToPath(new URL("../scripts/write-posix-build-info.js", import.meta.url));
  const commitSha = "1234567890abcdef1234567890abcdef12345678";
  execFileSync(process.execPath, [script, dir], { env: { ...process.env, GITHUB_SHA: commitSha, NOWPLAYING_CHANNEL: "development" } });
  const result = await readPosixPackageInfo(pathToFileURL(`${dir}/`));
  assert.equal(result.packageType, "portable");
  assert.equal(result.build.version, "0.2.0");
  assert.equal(result.build.commitSha, commitSha);
  assert.equal(result.build.channel, "development");
  assert.equal(result.build.signed, false);
  assert.equal(new Date(result.build.buildTime).toISOString(), result.build.buildTime);
  const broken = spawnSync(process.execPath, [script, dir], { env: { ...process.env, GITHUB_SHA: "short", NOWPLAYING_CHANNEL: "development" }, encoding: "utf8" });
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /commitSha is invalid/);
  assert.equal(JSON.parse(await readFile(join(dir, "build-info.json"), "utf8")).commitSha, commitSha);
});
