import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

export async function installVerifiedUpdate({ update, targetDir, unpack = unpackTar } = {}) {
  if (!update?.bytes || !(update.bytes instanceof Uint8Array) || typeof update.version !== "string") throw new TypeError("update: expected verified archive bytes");
  if (typeof targetDir !== "string" || !targetDir) throw new TypeError("targetDir: expected a path");
  if (typeof unpack !== "function") throw new TypeError("unpack: expected a function");
  const target = resolve(targetDir);
  if (target === resolve("/") || target === resolve(tmpdir())) throw new Error("refusing unsafe update target");
  await mkdir(dirname(target), { recursive: true });
  const work = await mkdtemp(join(dirname(target), ".nowplaying-update-"));
  const archive = join(work, update.filename || `nowplaying-v${update.version}.tar.gz`);
  const staged = join(work, "staged");
  const backup = `${target}.backup`;
  let movedCurrent = false;
  try {
    await mkdir(staged);
    await writeFile(archive, update.bytes, { mode: 0o600 });
    await unpack(archive, staged);
    const manifest = JSON.parse(await readFile(join(staged, "dist", "manifest.json"), "utf8"));
    if (manifest.version !== update.version) throw new Error("staged update version mismatch");
    await rm(backup, { recursive: true, force: true });
    try { await rename(target, backup); movedCurrent = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await rename(staged, target); }
    catch (error) { if (movedCurrent) await rename(backup, target); throw error; }
    return Object.freeze({ version: update.version, target, backup: movedCurrent ? backup : null, restartRequired: true });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function unpackTar(archive, destination) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("tar", ["-xzf", archive, "-C", destination, "--no-same-owner"], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error("update extraction failed")));
  });
}
