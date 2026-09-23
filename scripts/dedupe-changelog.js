// Drops repeated changelog bullets that release-please writes when the same
// change reaches main twice (a branch commit plus its merge commit share one
// message). Two bullets are the same when their text matches once the trailing
// commit link is removed. Only the first occurrence in each section is kept.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const COMMIT_LINK = /\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)\s*$/;

export function dedupeChangelog(text) {
  if (typeof text !== "string") throw new TypeError("changelog text must be a string");
  let seen = new Set();
  const out = [];
  for (const line of text.split("\n")) {
    if (/^#{1,3} /.test(line)) seen = new Set();
    const bullet = /^\* (.+)$/.exec(line);
    if (bullet) {
      const key = bullet[1].replace(COMMIT_LINK, "").trim();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(line);
  }
  return out.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node scripts/dedupe-changelog.js <file>"); process.exit(2); }
  const before = readFileSync(file, "utf8");
  const after = dedupeChangelog(before);
  if (after !== before) writeFileSync(file, after);
  console.log(after === before ? "unchanged" : "deduped");
}
