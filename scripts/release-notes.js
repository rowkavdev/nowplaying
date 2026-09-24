// Ranks the changes in a release and renders at most ten GitHub release-note
// bullets (#145). Used by the rolling development build and by stable releases
// so both pages read the same way. CHANGELOG.md is never touched here.
//
// Input is tab-separated, one commit per line, oldest first:
//   <sha>\t<pr number or empty>\t<changed lines + files>\t<subject>
//
// Ranking, best first: breaking, security, feature, fix, performance, other
// user-facing, then tests/docs/CI/chores. Within a class, bigger changes come
// first, then newer ones. Commits from one PR collapse into one entry. Internal
// changes only fill the list when there are fewer than ten user-facing ones.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_LIMIT = 10;
const INTERNAL = 9;
const TYPE_RANK = new Map([
  ["security", 1], ["sec", 1],
  ["feat", 2], ["feature", 2],
  ["fix", 3],
  ["perf", 4],
  ["test", INTERNAL], ["tests", INTERNAL], ["docs", INTERNAL], ["ci", INTERNAL],
  ["chore", INTERNAL], ["build", INTERNAL], ["style", INTERNAL], ["refactor", INTERNAL],
]);
const CONVENTIONAL = /^([A-Za-z]+)(?:\([^()]*\))?(!)?:\s/;
const TRAILING_PR = /\(#(\d+)\)\s*$/;

export function classify(subject) {
  const text = String(subject ?? "");
  const match = CONVENTIONAL.exec(text);
  if (/BREAKING[ -]CHANGE/.test(text) || match?.[2]) return 0;
  if (!match) return 5;
  return TYPE_RANK.get(match[1].toLowerCase()) ?? 5;
}

export function parseChanges(tsv) {
  const changes = [];
  String(tsv ?? "").split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    const [sha = "", pr = "", size = "", ...rest] = line.split("\t");
    const subject = rest.join("\t").trim();
    if (!/^[0-9a-f]{7,40}$/i.test(sha.trim())) throw new Error(`bad commit line: ${line.slice(0, 80)}`);
    const prNumber = /^\d+$/.test(pr.trim()) ? pr.trim() : TRAILING_PR.exec(subject)?.[1] ?? "";
    changes.push({ sha: sha.trim(), pr: prNumber, size: Number.parseInt(size, 10) || 0, subject, order: changes.length });
  });
  return changes;
}

function better(a, b) {
  return a.rank - b.rank || b.size - a.size || b.order - a.order || (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0);
}

export function rankChanges(changes, { limit = DEFAULT_LIMIT } = {}) {
  const groups = new Map();
  for (const change of changes) {
    const key = change.pr ? `pr-${change.pr}` : `commit-${change.sha}`;
    const commit = { ...change, rank: classify(change.subject) };
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { key, pr: change.pr, lead: commit, size: commit.size, order: commit.order });
      continue;
    }
    group.size += commit.size;
    group.order = Math.max(group.order, commit.order);
    if (better(commit, group.lead) < 0) group.lead = commit;
  }
  const entries = [...groups.values()].map((g) => ({
    key: g.key, pr: g.pr, sha: g.lead.sha, subject: g.lead.subject, rank: g.lead.rank, size: g.size, order: g.order,
  }));
  entries.sort(better);
  const userFacing = entries.filter((e) => e.rank < INTERNAL);
  const internal = entries.filter((e) => e.rank >= INTERNAL);
  const top = [...userFacing, ...internal].slice(0, limit);
  return { total: entries.length, top };
}

export function renderNotes(changes, { repo, limit = DEFAULT_LIMIT } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo ?? ""))) throw new Error("repo must be owner/name");
  const { total, top } = rankChanges(changes, { limit });
  const base = `https://github.com/${repo}`;
  const lines = top.map((e) => {
    const commit = `[\`${e.sha.slice(0, 7)}\`](${base}/commit/${e.sha})`;
    const pr = e.pr ? `[#${e.pr}](${base}/pull/${e.pr}), ` : "";
    return `- ${e.subject} (${pr}${commit})`;
  });
  if (!lines.length) lines.push("- No changes since the last stable release.");
  if (total > top.length) lines.push("", `Showing ${top.length} of ${total} changes. See Full Changelog for all changes.`);
  return `${lines.join("\n")}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [file, repo] = process.argv.slice(2);
  if (!file || !repo) {
    console.error("usage: node scripts/release-notes.js <changes.tsv> <owner/repo>");
    process.exit(2);
  }
  process.stdout.write(renderNotes(parseChanges(readFileSync(file, "utf8")), { repo }));
}
