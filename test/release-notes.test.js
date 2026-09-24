import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, parseChanges, rankChanges, renderNotes } from "../scripts/release-notes.js";

const sha = (n) => n.toString(16).padStart(40, "a");
const line = (n, pr, size, subject) => `${sha(n)}\t${pr}\t${size}\t${subject}`;

test("classifies conventional commits, including scoped ones", () => {
  assert.equal(classify("feat!: drop old config"), 0);
  assert.equal(classify("fix(api)!: rename route"), 0);
  assert.equal(classify("feat: x BREAKING CHANGE y"), 0);
  assert.equal(classify("security(updater): pin origin"), 1);
  assert.equal(classify("feat(settings): privacy section (#253) (#345)"), 2);
  assert.equal(classify("fix(discord): clear stuck track"), 3);
  assert.equal(classify("perf: faster render"), 4);
  assert.equal(classify("Tidy the tray menu"), 5);
  assert.equal(classify("docs(testing): privacy checks"), 9);
  assert.equal(classify("ci: cap notes"), 9);
  assert.equal(classify("test(discord): wiring"), 9);
});

test("an exclamation mark outside the type prefix is not breaking", () => {
  assert.equal(classify("fix: handle 'Wow!' titles: really"), 3);
});

test("priority beats size and recency", () => {
  const changes = parseChanges([
    line(1, "10", 5, "security: tighten headers"),
    line(2, "11", 9000, "fix: huge fix"),
    line(3, "12", 1, "feat!: new config"),
    line(4, "13", 50, "feat: small feature"),
  ].join("\n"));
  const { top } = rankChanges(changes);
  assert.deepEqual(top.map((e) => e.pr), ["12", "10", "13", "11"]);
});

test("within a class, bigger then newer wins, deterministically", () => {
  const changes = parseChanges([
    line(1, "1", 10, "fix: a"),
    line(2, "2", 30, "fix: b"),
    line(3, "3", 10, "fix: c"),
  ].join("\n"));
  const first = rankChanges(changes).top.map((e) => e.pr);
  assert.deepEqual(first, ["2", "3", "1"]);
  assert.deepEqual(rankChanges([...changes].reverse()).top.map((e) => e.pr), first);
});

test("commits from one PR collapse into one entry led by its best commit", () => {
  const changes = parseChanges([
    line(1, "20", 5, "test: cover it"),
    line(2, "20", 7, "feat(cards): themes"),
    line(3, "", 3, "fix: direct commit"),
  ].join("\n"));
  const { total, top } = rankChanges(changes);
  assert.equal(total, 2);
  assert.equal(top[0].pr, "20");
  assert.equal(top[0].subject, "feat(cards): themes");
  assert.equal(top[0].size, 12);
});

test("falls back to the trailing (#N) in the subject when no PR is given", () => {
  const [change] = parseChanges(line(1, "", 1, "feat(tray): settings (#253) (#341)"));
  assert.equal(change.pr, "341");
});

test("internal changes only fill space left by user-facing ones", () => {
  const rows = [];
  for (let i = 0; i < 12; i += 1) rows.push(line(i + 1, String(100 + i), 1000, `docs: page ${i}`));
  for (let i = 0; i < 3; i += 1) rows.push(line(i + 50, String(200 + i), 1, `fix: bug ${i}`));
  const { total, top } = rankChanges(parseChanges(rows.join("\n")));
  assert.equal(total, 15);
  assert.equal(top.length, 10);
  assert.deepEqual(top.slice(0, 3).map((e) => e.subject).sort(), ["fix: bug 0", "fix: bug 1", "fix: bug 2"]);
  assert.ok(top.slice(3).every((e) => e.subject.startsWith("docs:")));
});

test("renders at most ten bullets with an overflow line", () => {
  const rows = Array.from({ length: 14 }, (_, i) => line(i + 1, String(i + 1), i, `feat: thing ${i}`));
  const out = renderNotes(parseChanges(rows.join("\n")), { repo: "o/r" });
  assert.equal(out.split("\n").filter((l) => l.startsWith("- ")).length, 10);
  assert.match(out, /Showing 10 of 14 changes\. See Full Changelog for all changes\./);
  assert.match(out, /\[#14\]\(https:\/\/github\.com\/o\/r\/pull\/14\)/);
});

test("ten or fewer changes have no overflow line", () => {
  const rows = Array.from({ length: 10 }, (_, i) => line(i + 1, "", 1, `fix: thing ${i}`));
  const out = renderNotes(parseChanges(rows.join("\n")), { repo: "o/r" });
  assert.equal(out.split("\n").filter((l) => l.startsWith("- ")).length, 10);
  assert.doesNotMatch(out, /Showing/);
});

test("keeps the final record without a trailing newline and special characters", () => {
  const tsv = `${line(1, "", 1, "fix: a")}\n${line(2, "", 1, "feat: `$HOME` & \"quotes\"\tand a tab")}`;
  const out = renderNotes(parseChanges(tsv), { repo: "o/r" });
  assert.match(out, /feat: `\$HOME` & "quotes"\tand a tab/);
  assert.match(out, /fix: a/);
});

test("an empty change set says so", () => {
  assert.match(renderNotes([], { repo: "o/r" }), /No changes since the last stable release/);
});

test("rejects malformed lines and repos", () => {
  assert.throws(() => parseChanges("not-a-sha\t\t1\tfix: x"), /bad commit line/);
  assert.throws(() => renderNotes([], { repo: "bad repo" }), /owner\/name/);
});

test("CLI renders notes from a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "notes-"));
  const file = join(dir, "changes.tsv");
  writeFileSync(file, `${line(1, "7", 3, "fix: cli")}\n`);
  const out = execFileSync(process.execPath, ["scripts/release-notes.js", file, "o/r"], { encoding: "utf8" });
  assert.match(out, /- fix: cli \(\[#7\]/);
});
