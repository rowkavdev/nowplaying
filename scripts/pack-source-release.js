import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { releaseAssetNames } from "./release-artifacts.js";

const run = promisify(execFile);
const repository = fileURLToPath(new URL("..", import.meta.url));

export async function packSourceRelease({ root = repository, directory = root, tag } = {}) {
  const [name] = releaseAssetNames(tag);
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(root, "dist", "manifest.json"), "utf8"));
  if (`v${packageJson.version}` !== tag || manifest.version !== packageJson.version) throw new Error("source release version does not match the tag");
  const archive = resolve(directory, name);
  // Keep dist/manifest.json for existing updater validation, and include the
  // actual package entrypoints, CLI, resources and lockfile at their paths.
  await run("tar", ["--sort=name", "--mtime=UTC 1970-01-01", "--owner=0", "--group=0", "--numeric-owner", "-czf", archive,
    "dist/src", "dist/card.svg", "dist/manifest.json", "dist/NOTICE", "dist/README.md", "dist/LICENSE",
    "src", "scripts", "assets", "docs", "LICENSE", "NOTICE", "README.md", "CONTRIBUTING.md", "SECURITY.md", "package.json", "package-lock.json"], { cwd: root });
  return archive;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await packSourceRelease({ tag: process.env.GITHUB_REF_NAME }));
}
