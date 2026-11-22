import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const beta = readFileSync(new URL("../.github/workflows/beta.yml", import.meta.url), "utf8");
const baseVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
test("Windows dev download names stay stable when the installer carries build metadata", () => {
  // Exercise the workflow's replacement with the filenames produced by the
  // versioned ZIP and the build-labelled installer, as published in dev #719.
  const [, pattern, replacement] = beta.match(/\$name = \$_\.Name -replace '([^']+)', '([^']+)'/);
  for (const [filename, expected] of [
    ["nowplaying-v0.2.0-windows-x64.zip", "nowplaying-dev-windows-x64.zip"],
    ["nowplaying-v0.2.1-dev+72fe2ab-windows-x64-setup.exe", "nowplaying-dev-windows-x64-setup.exe"],
    ["nowplaying-v0.3.0-beta.12+abc1234-windows-x64-setup.exe", "nowplaying-dev-windows-x64-setup.exe"],
  ]) {
    assert.equal(filename.replace(new RegExp(pattern), replacement), expected);
  }
});

test("rolling dev release awaits native distro packages and covers them in checksums and upload", () => {
  assert.match(beta, /linux-native:/);
  assert.match(beta, /needs: \[windows, macos, linux, linux-native, attest\]/);
  for (const extension of ["*.deb", "*.rpm", "*.pkg.tar.zst"]) {
    assert.ok(beta.split(extension).length >= 4, `${extension} must cover upload, attestation, checksums, release files`);
  }
  assert.match(beta, /--prerelease --latest=false/);
});

test("native package versions put the dev build number before the short SHA", { skip: process.platform !== "linux" }, () => {
  const [, assignment] = beta.match(/^ +(package_version=.*)$/m);
  for (const [buildNumber, sha, shortSha] of [["742", "8505f3100", "8505f31"], ["743", "21cbba100", "21cbba1"]]) {
    const version = execFileSync("bash", ["-c", assignment + '\n' + 'printf "%s" "$package_version"'], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, GITHUB_RUN_NUMBER: buildNumber, GITHUB_SHA: sha },
      encoding: "utf8",
    });
    assert.equal(version, `${baseVersion}+dev.10000000.${buildNumber}.${shortSha}`);
  }
});

test("PR build legs have read-only grants and release/attestation require trusted main", () => {
  const build = beta.slice(beta.indexOf("  windows:"), beta.indexOf("  attest:"));
  assert.doesNotMatch(build, /id-token: write|attestations: write|contents: write/);
  assert.doesNotMatch(build, /actions\/attest-build-provenance/);
  assert.equal((beta.match(/if: github.ref == 'refs\/heads\/main' && \(github.event_name == 'push' \|\| github.event_name == 'workflow_dispatch'\)/g) ?? []).length, 2);
  assert.doesNotMatch(beta, /pull_request_target/);
});
