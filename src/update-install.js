import { access, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

export async function installVerifiedUpdate({ update, targetDir, unpack = unpackArchive, renameImpl = rename } = {}) {
  if (!update?.bytes || !(update.bytes instanceof Uint8Array) || typeof update.version !== "string") throw new TypeError("update: expected verified archive bytes");
  if (typeof targetDir !== "string" || !targetDir) throw new TypeError("targetDir: expected a path");
  if (typeof unpack !== "function") throw new TypeError("unpack: expected a function");
  if (typeof renameImpl !== "function") throw new TypeError("renameImpl: expected a function");
  const target = resolve(targetDir);
  if (target === resolve("/") || target === resolve(tmpdir())) throw new Error("refusing unsafe update target");
  await mkdir(dirname(target), { recursive: true });
  const work = await mkdtemp(join(dirname(target), ".nowplaying-update-"));
  // The archive name never comes from outside this folder.
  const name = safeArchiveName(update.filename);
  const bundle = name?.endsWith(".zip") ?? false;
  const archive = join(work, name ?? "update.tar.gz");
  const staged = join(work, "staged");
  const backup = `${target}.backup`;
  let movedCurrent = false;
  try {
    await mkdir(staged);
    await writeFile(archive, update.bytes, { mode: 0o600 });
    await unpack(archive, staged);
    await (bundle ? checkWindowsBundle(staged, update.version) : checkSourceArchive(staged, update.version));
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

async function checkSourceArchive(staged, version) {
  const manifest = JSON.parse(await readFile(join(staged, "dist", "manifest.json"), "utf8"));
  if (manifest.version !== version) throw new Error("staged update version mismatch");
}

// The Windows bundle (#373): launcher, runtime and app must all be there, and
// the app's build info must name the version we verified, before any swap.
async function checkWindowsBundle(staged, version) {
  const info = JSON.parse(await readFile(join(staged, "app", "build-info.json"), "utf8"));
  if (info.version !== version) throw new Error("staged update version mismatch");
  for (const file of ["nowplaying.exe", join("runtime", "node.exe"), join("app", "package.json")]) {
    try { await access(join(staged, file)); } catch { throw new Error(`staged Windows bundle is missing ${file.replaceAll("\\", "/")}`); }
  }
}

function safeArchiveName(value) {
  // A bare file name: no separators, no "..", and only ever a .tar.gz or .zip.
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(tar\.gz|zip)$/.test(value) && !value.includes("..") ? value : null;
}

function unpackArchive(archive, destination) {
  // Windows' built-in tar (bsdtar) reads zip and refuses absolute or ".." paths.
  // Zips are only published for Windows; unzip covers tests on other systems.
  const [command, args] = !archive.endsWith(".zip")
    ? ["tar", ["-xzf", archive, "-C", destination, "--no-same-owner"]]
    : process.platform === "win32" ? ["tar", ["-xf", archive, "-C", destination]] : ["unzip", ["-q", archive, "-d", destination]];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error("update extraction failed")));
  });
}
