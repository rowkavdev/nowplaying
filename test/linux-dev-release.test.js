import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const beta = readFileSync(new URL("../.github/workflows/beta.yml", import.meta.url), "utf8");
test("rolling dev release awaits native distro packages and covers them in checksums and upload", () => {
  assert.match(beta, /linux-native:/);
  assert.match(beta, /needs: \[windows, macos, linux, linux-native, attest\]/);
  for (const extension of ["*.deb", "*.rpm", "*.pkg.tar.zst"]) {
    assert.ok(beta.split(extension).length >= 4, `${extension} must cover upload, attestation, checksums, release files`);
  }
  assert.match(beta, /--prerelease --latest=false/);
});

test("PR build legs have read-only grants and release/attestation require trusted main", () => {
  const build = beta.slice(beta.indexOf("  windows:"), beta.indexOf("  attest:"));
  assert.doesNotMatch(build, /id-token: write|attestations: write|contents: write/);
  assert.doesNotMatch(build, /actions\/attest-build-provenance/);
  assert.equal((beta.match(/if: github.ref == 'refs\/heads\/main' && \(github.event_name == 'push' \|\| github.event_name == 'workflow_dispatch'\)/g) ?? []).length, 2);
  assert.doesNotMatch(beta, /pull_request_target/);
});
