import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function releaseAssetNames(tag) {
  if (typeof tag !== "string" || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) throw new TypeError("release tag must be vX.Y.Z");
  return [`nowplaying-${tag}.tar.gz`, `nowplaying-${tag}.spdx.json`, `nowplaying-${tag}-windows-x64-setup.exe`, `nowplaying-${tag}-windows-x64.zip`];
}

export async function verifyReleaseArtifacts(directory, tag) {
  const names = releaseAssetNames(tag);
  const manifest = await readFile(join(directory, "SHA256SUMS"), "utf8");
  const hashes = new Map();
  for (const line of manifest.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) [ *]([^/\\]+)$/.exec(line);
    if (!match || !names.includes(match[2]) || hashes.has(match[2])) throw new Error("release checksums must name each release asset exactly once");
    hashes.set(match[2], match[1]);
  }
  if (hashes.size !== names.length) throw new Error("release checksums are incomplete");
  for (const name of names) {
    const bytes = await readFile(join(directory, name));
    if (!bytes.length || createHash("sha256").update(bytes).digest("hex") !== hashes.get(name)) throw new Error(`release checksum mismatch: ${name}`);
  }
  return Object.freeze([...names, "SHA256SUMS"]);
}
