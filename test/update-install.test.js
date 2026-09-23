import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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

async function installRoot() {
  const root = await mkdtemp(join(tmpdir(), "nowplaying-install-test-"));
  const target = join(root, "app");
  await mkdir(target);
  await writeFile(join(target, "old.txt"), "old");
  return { root, target };
}
const goodUnpack = async (_archive, staged) => { await mkdir(join(staged, "dist")); await writeFile(join(staged, "dist", "manifest.json"), JSON.stringify({ version: "0.2.0" })); };
const leftovers = async (root) => (await readdir(root)).filter((name) => name.startsWith(".nowplaying-update-") || name.endsWith(".backup"));

test("an interrupted swap puts the current install back", async () => {
  const { root, target } = await installRoot();
  const renameImpl = async (from, to) => { if (to === target) throw Object.assign(new Error("EBUSY: file in use"), { code: "EBUSY" }); return rename(from, to); };
  await assert.rejects(installVerifiedUpdate({ update: { bytes, version: "0.2.0" }, targetDir: target, unpack: goodUnpack, renameImpl }), /EBUSY/);
  assert.equal(await readFile(join(target, "old.txt"), "utf8"), "old");
  assert.deepEqual(await leftovers(root), []);
});

test("a failed extraction leaves the current install untouched", async () => {
  const { root, target } = await installRoot();
  await assert.rejects(installVerifiedUpdate({ update: { bytes, version: "0.2.0" }, targetDir: target, unpack: async () => { throw new Error("update extraction failed"); } }), /extraction failed/);
  assert.equal(await readFile(join(target, "old.txt"), "utf8"), "old");
  assert.deepEqual(await leftovers(root), []);
});

test("a missing or corrupt manifest never replaces the install", async () => {
  const { root, target } = await installRoot();
  await assert.rejects(installVerifiedUpdate({ update: { bytes, version: "0.2.0" }, targetDir: target, unpack: async () => {} }), /ENOENT/);
  const corrupt = async (_archive, staged) => { await mkdir(join(staged, "dist")); await writeFile(join(staged, "dist", "manifest.json"), "{not json"); };
  await assert.rejects(installVerifiedUpdate({ update: { bytes, version: "0.2.0" }, targetDir: target, unpack: corrupt }), SyntaxError);
  assert.equal(await readFile(join(target, "old.txt"), "utf8"), "old");
  assert.deepEqual(await leftovers(root), []);
});

test("a hostile archive filename can't write outside the work folder", async () => {
  const { root, target } = await installRoot();
  let archivePath;
  const unpack = async (archive, staged) => { archivePath = archive; await goodUnpack(archive, staged); };
  await installVerifiedUpdate({ update: { bytes, version: "0.2.0", filename: "../../escape.tar.gz" }, targetDir: target, unpack });
  assert.equal(basename(archivePath), "update.tar.gz");
  assert.ok(!(await readdir(root)).includes("escape.tar.gz"));
});
