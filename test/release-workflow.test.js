import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const cadence = readFileSync(new URL("../.github/workflows/release-cadence.yml", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../release-please-config.json", import.meta.url), "utf8"));

test("stable release remains a draft with a real tag until notes and artifacts are ready", () => {
  assert.equal(config.packages["."].draft, true);
  assert.equal(config.packages["."]["force-tag-creation"], true, "draft creation alone does not create the ref needed for dispatch");
  const dispatch = cadence.slice(cadence.indexOf("  start-release-workflow:"));
  assert.match(dispatch, /needs: \[release-please, stable-release-notes\]/);
  assert.match(dispatch, /gh workflow run release\.yml[^\n]*--ref "\$TAG"/);
  assert.match(cadence, /gh release list[^\n]*--exclude-drafts[^\n]*--exclude-pre-releases/);
  assert.doesNotMatch(cadence, /previous=\$\(git tag/);
  assert.doesNotMatch(release, /--clobber/);
  assert.match(release, /run: node scripts\/publish-release\.js/);
});

test("stable builds smoke the source package and isolated Windows launchers before publication", () => {
  assert.match(release, /run: npm run check/);
  assert.match(release, /run: npm audit --omit=dev --audit-level=high/);
  assert.match(release, /node scripts\/pack-source-release\.js\n\s+node scripts\/check-source-release\.js/);
  assert.match(release, /node --test test\/windows-bundle-smoke\.test\.js/);
  assert.match(release, /NOWPLAYING_CHANNEL: stable/);
  assert.match(release, /sha256sum --check SHA256SUMS/);
  const publish = release.slice(release.indexOf("  publish:"));
  assert.match(publish, /needs: \[verify, windows\]/);
  assert.ok(publish.indexOf("actions/download-artifact") < publish.indexOf("node scripts/publish-release.js"));
});

test("manual dispatch cannot build a branch or an arbitrary tag as a stable release", { skip: process.platform === "win32" }, () => {
  const command = release.match(/- name: Require a vX\.Y\.Z tag\n\s+run: '([^\n]+)'/)[1];
  for (const [type, name, status] of [["branch", "main", 1], ["branch", "v0.2.1", 1], ["tag", "dev", 1], ["tag", "v0.2.1-beta.1", 1], ["tag", "v0.2.1", 0]]) {
    const result = spawnSync("bash", ["-c", command], { env: { ...process.env, GITHUB_REF_TYPE: type, GITHUB_REF_NAME: name } });
    assert.equal(result.status, status, `${type} ${name}`);
  }
});
