#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBuildProvenance } from "../src/build-provenance.js";

const appDirectory = process.argv[2];
if (!appDirectory) throw new TypeError("built app directory is required");
const { version } = JSON.parse(await readFile(join(appDirectory, "package.json"), "utf8"));
const build = createBuildProvenance({
  version,
  commitSha: process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  buildTime: new Date().toISOString(),
  channel: process.env.NOWPLAYING_CHANNEL ?? "development",
  signed: false,
});
await writeFile(join(appDirectory, "build-info.json"), `${JSON.stringify(build, null, 2)}\n`);
await writeFile(join(appDirectory, "package-info.json"), `${JSON.stringify({ packageType: "portable" })}\n`);
