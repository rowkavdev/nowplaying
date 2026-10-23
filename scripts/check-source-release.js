import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function checkSourceRelease({ archive, installDependencies } = {}) {
  if (!archive) throw new TypeError("source release archive is required");
  const directory = await mkdtemp(join(tmpdir(), "nowplaying-source-smoke-"));
  try {
    await run("tar", ["-xzf", resolve(archive), "-C", directory]);
    if (installDependencies) await installDependencies(directory);
    else await run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--ignore-scripts"], { cwd: directory });
    const manifest = JSON.parse(await readFile(join(directory, "dist", "manifest.json"), "utf8"));
    const packageJson = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    if (packageJson.version !== manifest.version) throw new Error("source release manifest version mismatch");
    // Exercise the package's public exports from inside the extracted archive,
    // where a missing root src/ cannot be masked by the build checkout.
    await run(process.execPath, ["--input-type=module", "-e", `
      import { renderCard, createPresence } from "nowplaying";
      import "nowplaying/card";
      import "nowplaying/providers/jellyfin";
      if (!renderCard(createPresence({ state: "idle" })).includes("<svg")) throw new Error("missing card");
      const { default: sharp } = await import("sharp");
      await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
    `], { cwd: directory });
    const version = await run(process.execPath, ["scripts/nowplaying.js", "--version"], { cwd: directory });
    if (version.stdout.trim() !== packageJson.version) throw new Error("source release CLI version mismatch");
    const help = await run(process.execPath, ["scripts/nowplaying.js", "--help"], { cwd: directory });
    if (!help.stdout.includes("Usage:")) throw new Error("source release CLI help is missing");
    return packageJson.version;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Verified source release ${await checkSourceRelease({ archive: process.argv[2] })}`);
}
