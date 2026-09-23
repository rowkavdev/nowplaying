import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dedupeChangelog } from "../scripts/dedupe-changelog.js";

const SAMPLE = `## [0.2.0](https://x/compare) (2026-09-23)

### Features

* add provider adapter contract ([506ac48](https://x/commit/506ac48b))
* add provider adapter contract ([b2a9ad7](https://x/commit/b2a9ad76))
* add config core ([#182](https://x/issues/182)) ([1175ff7](https://x/commit/1175ff7a))
* add config core ([#182](https://x/issues/182)) ([4e2dd7f](https://x/commit/4e2dd7f5))
* render card

### Fixes

* render card ([8c2fc30](https://x/commit/8c2fc30a))
* declare SVG UTF-8 encoding ([8c2fc30](https://x/commit/8c2fc30a))
* declare SVG UTF-8 encoding ([96b9186](https://x/commit/96b91863))
`;

test("keeps the first of each repeated bullet within a section", () => {
  const out = dedupeChangelog(SAMPLE);
  assert.equal(out.match(/add provider adapter contract/g).length, 1);
  assert.match(out, /506ac48/);
  assert.doesNotMatch(out, /b2a9ad7/);
  assert.equal(out.match(/add config core/g).length, 1);
  assert.match(out, /#182/);
  assert.equal(out.match(/declare SVG UTF-8 encoding/g).length, 1);
});

test("same text in different sections or releases is kept", () => {
  const out = dedupeChangelog(SAMPLE);
  assert.equal(out.match(/render card/g).length, 2);
  const twoReleases = "## 0.3.0\n\n### Features\n\n* a ([1111111](u))\n\n## 0.2.0\n\n### Features\n\n* a ([2222222](u))\n";
  assert.equal(dedupeChangelog(twoReleases), twoReleases);
});

test("leaves other lines and clean changelogs untouched", () => {
  const clean = "# Changelog\n\nIntro.\n\n## [Unreleased]\n\n- Provider model.\n- Provider model.\n";
  assert.equal(dedupeChangelog(clean), clean);
  assert.throws(() => dedupeChangelog(null), TypeError);
});

test("the CLI rewrites a file only when needed", () => {
  const dir = mkdtempSync(join(tmpdir(), "cl-"));
  const file = join(dir, "CHANGELOG.md");
  writeFileSync(file, SAMPLE);
  assert.match(execFileSync(process.execPath, ["scripts/dedupe-changelog.js", file], { encoding: "utf8" }), /deduped/);
  assert.equal(readFileSync(file, "utf8"), dedupeChangelog(SAMPLE));
  assert.match(execFileSync(process.execPath, ["scripts/dedupe-changelog.js", file], { encoding: "utf8" }), /unchanged/);
});

test("matching is exact, so different capitalisation is kept", () => {
  const text = "### Features\n\n* Fix Plex art ([1111111](u))\n* fix plex art ([2222222](u))\n";
  assert.equal(dedupeChangelog(text), text);
});
