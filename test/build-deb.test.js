import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/build-deb.sh", import.meta.url).pathname;
const haveDpkg = spawnSync("dpkg-deb", ["--version"]).status === 0 && spawnSync("fakeroot", ["--version"]).status === 0;

function fakeBundle() {
  const dir = mkdtempSync(join(tmpdir(), "np-deb-"));
  const bundle = join(dir, "nowplaying");
  mkdirSync(join(bundle, "runtime"), { recursive: true });
  mkdirSync(join(bundle, "app"), { recursive: true });
  writeFileSync(join(bundle, "nowplaying"), "#!/bin/sh\nexit 0\n"); chmodSync(join(bundle, "nowplaying"), 0o755);
  writeFileSync(join(bundle, "runtime", "node"), "#!/bin/sh\nexit 0\n"); chmodSync(join(bundle, "runtime", "node"), 0o755);
  writeFileSync(join(bundle, "app", "package.json"), "{}");
  return { dir, bundle };
}

test("rejects a bad version or architecture before building", () => {
  const { dir, bundle } = fakeBundle();
  const bad = [[bundle, "0.2.0\nSection: evil", "amd64", dir, /invalid version/], [bundle, "v0.2", "amd64", dir, /invalid version/], [bundle, "0.2.0", "i386", dir, /unsupported architecture/]];
  for (const [bundleDir, version, arch, out, message] of bad) {
    const result = spawnSync("bash", [script, bundleDir, version, arch, out], { encoding: "utf8" });
    assert.equal(result.status, 2, JSON.stringify(version));
    assert.match(result.stderr, message, JSON.stringify(version));
  }
  assert.equal(spawnSync("bash", [script, join(dir, "missing"), "0.2.0", "amd64", dir], { encoding: "utf8" }).status, 2);
});

test("builds a .deb with the bundle under /opt, a wrapper in /usr/bin and root ownership", { skip: !haveDpkg && "dpkg-deb or fakeroot not installed" }, () => {
  const { dir, bundle } = fakeBundle();
  const file = execFileSync("bash", [script, bundle, "0.2.0", "arm64", dir], { encoding: "utf8" }).trim();
  assert.ok(file.endsWith("nowplaying_0.2.0_arm64.deb"));
  const info = execFileSync("dpkg-deb", ["-f", file], { encoding: "utf8" });
  assert.match(info, /^Package: nowplaying$/m);
  assert.match(info, /^Version: 0\.2\.0$/m);
  assert.match(info, /^Architecture: arm64$/m);
  assert.match(info, /^Depends: libc6, libstdc\+\+6, libgcc-s1$/m);
  assert.doesNotMatch(info, /evil/);
  const listing = execFileSync("dpkg-deb", ["-c", file], { encoding: "utf8" });
  assert.match(listing, /\.\/opt\/nowplaying\/runtime\/node$/m);
  assert.match(listing, /^-rwxr-xr-x root\/root .*\.\/usr\/bin\/nowplaying$/m);
  assert.doesNotMatch(listing, /^\S+ (?!root\/root)\S+/m);
  assert.match(listing, /^drwxr-xr-x root\/root .* \.\/$/m);
});
