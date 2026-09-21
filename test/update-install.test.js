import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installVerifiedUpdate } from "../src/update-install.js";

const bytes = new Uint8Array([1, 2, 3]);

test("stages, validates and swaps an update while keeping a backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "nowplaying-install-test-"));
  const target = join(root, "app");
  await mkdir(target);
  await writeFile(join(target, "old.txt"), "old");
  const unpack = async (_archive, staged) => { await mkdir(join(staged, "dist")); await writeFile(join(staged, "dist", "manifest.json"), JSON.stringify({ version: "0.2.0" })); await writeFile(join(staged, "new.txt"), "new"); };
  const result = await installVerifiedUpdate({ update: { bytes, version: "0.2.0", filename: "update.tgz" }, targetDir: target, unpack });
  assert.equal(await readFile(join(target, "new.txt"), "utf8"), "new");
  assert.equal(await readFile(join(result.backup, "old.txt"), "utf8"), "old");
  assert.equal(result.restartRequired, true);
});

test("refuses a staged archive whose manifest version differs", async () => {
  const root = await mkdtemp(join(tmpdir(), "nowplaying-install-test-"));
  const unpack = async (_archive, staged) => { await mkdir(join(staged, "dist")); await writeFile(join(staged, "dist", "manifest.json"), JSON.stringify({ version: "9.9.9" })); };
  await assert.rejects(installVerifiedUpdate({ update: { bytes, version: "0.2.0" }, targetDir: join(root, "app"), unpack }), /version mismatch/);
});
