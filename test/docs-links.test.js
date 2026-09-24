import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Offline checks for the docs (#142): relative links and #anchors resolve,
// links to this repo's files on github.com point at files that exist, file
// paths named in `code` exist, and every `npm run <script>` is a real script.
// No network, so this can't flake on someone else's website.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_URL = /^https:\/\/github\.com\/rowkavdev\/nowplaying\/(?:blob|tree)\/main\/([^?#]+)(#[^?]*)?$/;
const PATH_IN_CODE = /^(?:src|scripts|test|hosted|docs|assets|\.github)\/[\w./-]+\.[a-z0-9]+$/i;

const files = execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const scripts = Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {});

// Drops fenced code blocks (links in examples aren't real links) but keeps
// their text for the npm-script check.
function split(text) {
  const prose = [];
  const code = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; code.push(""); prose.push(""); continue; }
    (fenced ? code : prose).push(line);
    (fenced ? prose : code).push("");
  }
  return { prose: prose.join("\n"), code: code.join("\n") };
}

// GitHub's heading anchors: lowercase, drop punctuation, spaces to dashes,
// repeats get -1, -2...
const anchorCache = new Map();
function anchors(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const seen = new Map();
  const set = new Set();
  const { prose } = split(readFileSync(file, "utf8"));
  for (const match of prose.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1].replace(/`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").toLowerCase().trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    set.add(n ? `${base}-${n}` : base);
  }
  for (const match of prose.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) set.add(match[1]);
  anchorCache.set(file, set);
  return set;
}

// Resolves a relative link from a doc to a file on disk. Wiki pages link to
// each other without .md, the way the GitHub wiki does.
function target(fromFile, link) {
  const clean = decodeURIComponent(link.split(/[?#]/)[0]);
  if (!clean) return fromFile;
  const base = clean.startsWith("/") ? join(ROOT, clean) : resolve(dirname(fromFile), clean);
  if (existsSync(base)) return base;
  if (fromFile.includes(`${join("docs", "wiki")}`) && existsSync(`${base}.md`)) return `${base}.md`;
  return null;
}

function checkAnchor(file, hash, where, problems) {
  if (!hash || !file.endsWith(".md") || statSync(file).isDirectory()) return;
  const id = decodeURIComponent(hash.slice(1)).toLowerCase();
  if (/^l\d+(-l\d+)?$/.test(id)) return; // line links
  if (!anchors(file).has(id)) problems.push(`${where}: no heading for ${hash} in ${relative(ROOT, file)}`);
}

function problemsIn(rel) {
  const file = join(ROOT, rel);
  const { prose, code } = split(readFileSync(file, "utf8"));
  const problems = [];
  const links = [
    ...[...prose.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
    ...[...prose.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/gm)].map((m) => m[1]),
    ...[...prose.matchAll(/<(?:a|img)\s[^>]*?(?:href|src)="([^"]+)"/g)].map((m) => m[1]),
  ];
  for (const link of links) {
    const where = `${rel} -> ${link}`;
    const repo = REPO_URL.exec(link);
    if (repo) {
      const path = join(ROOT, decodeURIComponent(repo[1]).replace(/\/$/, ""));
      if (!existsSync(path)) problems.push(`${where}: ${repo[1]} isn't in the repo`);
      else checkAnchor(path, repo[2], where, problems);
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue; // other sites, mailto:
    const hash = link.includes("#") ? link.slice(link.indexOf("#")) : "";
    const found = target(file, link);
    if (!found) { problems.push(`${where}: file not found`); continue; }
    checkAnchor(found, hash, where, problems);
  }
  for (const match of prose.matchAll(/`([^`\n]+)`/g)) {
    const path = match[1].trim();
    if (PATH_IN_CODE.test(path) && !existsSync(join(ROOT, path))) problems.push(`${rel}: \`${path}\` isn't in the repo`);
  }
  for (const match of `${prose}\n${code}`.matchAll(/\bnpm run ([\w:.-]+)/g)) {
    if (!scripts.includes(match[1])) problems.push(`${rel}: npm run ${match[1]} isn't a script in package.json`);
  }
  return problems;
}

test("docs find their markdown files", () => {
  assert.ok(files.includes("README.md"));
  assert.ok(files.some((f) => f.startsWith("docs/wiki/")));
});

for (const rel of files) {
  test(`docs links, paths and npm scripts resolve: ${rel}`, () => {
    assert.deepEqual(problemsIn(rel), []);
  });
}
