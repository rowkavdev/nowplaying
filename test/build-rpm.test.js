import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/build-rpm.sh", import.meta.url).pathname;
const haveRpm = spawnSync("rpmbuild", ["--version"]).status === 0 && spawnSync("rpm", ["--version"]).status === 0;

function fakeBundle() {
  const dir = mkdtempSync(join(tmpdir(), "np-rpm-"));
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
  // The second case would add a spec line if the version reached the spec file.
  const bad = [[bundle, "0.2.0\nRequires: evil", "amd64", /invalid version/], [bundle, "v0.2", "amd64", /invalid version/], [bundle, "0.2.0", "i386", /unsupported architecture/]];
  for (const [bundleDir, version, arch, message] of bad) {
    const result = spawnSync("bash", [script, bundleDir, version, arch, dir], { encoding: "utf8" });
    assert.equal(result.status, 2, JSON.stringify(version));
    assert.match(result.stderr, message, JSON.stringify(version));
  }
  assert.equal(spawnSync("bash", [script, join(dir, "missing"), "0.2.0", "amd64", dir], { encoding: "utf8" }).status, 2);
});

test("builds an .rpm with the bundle under /opt, a wrapper in /usr/bin and root ownership", { skip: !haveRpm && "rpmbuild not installed" }, () => {
  const { dir, bundle } = fakeBundle();
  const file = execFileSync("bash", [script, bundle, "0.3.0-beta.1", "arm64", dir], { encoding: "utf8" }).trim().split("\n").pop();
  assert.ok(file.endsWith("aarch64/nowplaying-0.3.0~beta.1-1.aarch64.rpm"), file);
  const query = (...args) => execFileSync("rpm", ["-qp", ...args, file], { encoding: "utf8" });
  assert.equal(query("--qf", "%{NAME} %{VERSION} %{ARCH}"), "nowplaying 0.3.0~beta.1 aarch64");
  const requires = query("--requires").split("\n").filter((line) => line && !line.startsWith("rpmlib("));
  assert.deepEqual(requires.sort(), ["glibc", "libgcc", "libstdc++"]);
  const listing = query("-lv");
  assert.match(listing, /^-rwxr-xr-x\s+1 root\s+root .* \/opt\/nowplaying\/runtime\/node$/m);
  assert.match(listing, /^-rwxr-xr-x\s+1 root\s+root .* \/usr\/bin\/nowplaying$/m);
  assert.match(listing, /^drwxr-xr-x\s+\d+ root\s+root .* \/opt\/nowplaying$/m);
  assert.doesNotMatch(listing, /^\S+\s+\d+ (?!root\s+root)\S+\s+\S+ /m);
  assert.doesNotMatch(query("--qf", "%{PACKAGER}%{VERSION}"), /evil/);
});
