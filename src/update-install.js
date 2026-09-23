import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

export async function installVerifiedUpdate({ update, targetDir, unpack = unpackTar, renameImpl = rename } = {}) {
  if (!update?.bytes || !(update.bytes instanceof Uint8Array) || typeof update.version !== "string") throw new TypeError("update: expected verified archive bytes");
  if (typeof targetDir !== "string" || !targetDir) throw new TypeError("targetDir: expected a path");
  if (typeof unpack !== "function") throw new TypeError("unpack: expected a function");
  if (typeof renameImpl !== "function") throw new TypeError("renameImpl: expected a function");
  const target = resolve(targetDir);
  if (target === resolve("/") || target === resolve(tmpdir())) throw new Error("refusing unsafe update target");
  await mkdir(dirname(target), { recursive: true });
  const work = await mkdtemp(join(dirname(target), ".nowplaying-update-"));
  // The archive name never comes from outside this folder.
  const archive = join(work, safeArchiveName(update.filename) ?? "update.tar.gz");
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
    try { await renameImpl(target, backup); movedCurrent = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await renameImpl(staged, target); }
    catch (error) {
      // Restore with the real rename: if even that fails, say so, because the
      // install is then only in the backup folder.
      if (movedCurrent) {
        try { await rename(backup, target); }
        catch (restoreError) { throw new AggregateError([error, restoreError], `update swap failed and the previous install is left at ${backup}`); }
      }
      throw error;
    }
    return Object.freeze({ version: update.version, target, backup: movedCurrent ? backup : null, restartRequired: true });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function safeArchiveName(value) {
  // A bare file name: no separators, no "..", and only ever a .tar.gz.
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.tar\.gz$/.test(value) && !value.includes("..") ? value : null;
}

function unpackTar(archive, destination) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("tar", ["-xzf", archive, "-C", destination, "--no-same-owner"], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error("update extraction failed")));
  });
}
