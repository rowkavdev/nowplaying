import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const linuxOnly = { skip: process.platform !== "linux" };
const root = new URL("../", import.meta.url).pathname;
test("common staging contains a non-terminal desktop entry and branding", linuxOnly, () => {
  const dir = mkdtempSync(join(tmpdir(), "np-native-"));
  const bundle = join(dir, "bundle");
  mkdirSync(join(bundle, "runtime"), { recursive: true });
  mkdirSync(join(bundle, "app/assets/brand/png"), { recursive: true });
  for (const file of ["nowplaying", "runtime/node"]) {
    writeFileSync(join(bundle, file), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bundle, file), 0o777);
  }
  writeFileSync(join(bundle, "app/assets/brand/png/icon-512.png"), "test");
  chmodSync(join(bundle, "app/assets/brand/png/icon-512.png"), 0o777);
  chmodSync(join(bundle, "app/assets/brand/png"), 0o777);
  const stage = join(dir, "stage");
  execFileSync("bash", [join(root, "scripts/stage-linux-package.sh"), bundle, stage]);
  const entry = readFileSync(join(stage, "usr/share/applications/nowplaying.desktop"), "utf8");
  assert.equal(statSync(join(stage, "opt/nowplaying/runtime/node")).mode & 0o777, 0o755);
  assert.equal(statSync(join(stage, "opt/nowplaying/app/assets/brand/png/icon-512.png")).mode & 0o777, 0o644);
  assert.equal(statSync(join(stage, "opt/nowplaying/app/assets/brand/png")).mode & 0o777, 0o755);
  assert.match(entry, /^Terminal=false$/m);
  assert.match(entry, /^Exec=\/usr\/bin\/nowplaying start$/m);
  assert.match(entry, /^Icon=nowplaying$/m);
  assert.match(readFileSync(join(stage, "usr/bin/nowplaying"), "utf8"), /exec \/opt\/nowplaying\/nowplaying "\$@"/);
});

test("native builder rejects invalid package version and unknown format", linuxOnly, () => {
  const bundle = mkdtempSync(join(tmpdir(), "np-package-bad-"));
  const out = join(bundle, "out");
  mkdirSync(join(bundle, "runtime"));
  writeFileSync(join(bundle, "runtime/node"), "#!/bin/sh\ntouch FORMAT_PROBE_RAN\nprintf x64\n");
  chmodSync(join(bundle, "runtime/node"), 0o755);
  for (const [kind, version] of [["deb", "0.2\nRequires: injected"], ["other", "0.2.1"]]) {
    const result = spawnSync("bash", [join(root, "scripts/build-linux-native.sh"), kind, bundle, version, out], { encoding: "utf8" });
    assert.equal(result.status, 2);
    if (kind === "other") assert.match(result.stderr, /Unknown package format/);
  }
});

test("native staging accepts internal links but rejects paths escaping the bundle", linuxOnly, () => {
  const dir = mkdtempSync(join(tmpdir(), "np-native-links-"));
  const bundle = join(dir, "bundle");
  mkdirSync(join(bundle, "runtime"), { recursive: true });
  mkdirSync(join(bundle, "app/assets/brand/png"), { recursive: true });
  for (const file of ["nowplaying", "runtime/node"]) { writeFileSync(join(bundle, file), "#!/bin/sh\nexit 0\n"); chmodSync(join(bundle, file), 0o755); }
  writeFileSync(join(bundle, "app/assets/brand/png/icon-512.png"), "test");
  symlinkSync("icon-512.png", join(bundle, "app/assets/brand/png/alias.png"));
  execFileSync("bash", [join(root, "scripts/stage-linux-package.sh"), bundle, join(dir, "good")]);
  writeFileSync(join(dir, "outside"), "outside");
  symlinkSync(join(dir, "outside"), join(bundle, "escape"));
  const result = spawnSync("bash", [join(root, "scripts/stage-linux-package.sh"), bundle, join(dir, "bad")], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /escapes/);
});

test("native builder rejects unsupported versions and bundled arm64 before packaging", { skip: process.platform !== "linux" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "np-native-arch-"));
  mkdirSync(join(dir, "runtime"));
  writeFileSync(join(dir, "runtime/node"), "#!/bin/sh\nprintf arm64\n");
  chmodSync(join(dir, "runtime/node"), 0o755);
  for (const format of ["deb", "rpm", "arch"]) {
    for (const version of ["0.2~dev", "0.2_dev", "0.2.1+dev"]) {
      const result = spawnSync("bash", [join(root, "scripts/build-linux-native.sh"), format, dir, version, join(dir, "out")], { encoding: "utf8" });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Invalid package version|Bundle architecture|require x86_64/);
    }
  }
});

test("prebuilt RPM spec disables debug packages and has a changelog", linuxOnly, () => {
  const dir = mkdtempSync(join(tmpdir(), "np-rpm-spec-"));
  const bundle = join(dir, "bundle"); const bin = join(dir, "bin");
  mkdirSync(join(bundle, "runtime"), { recursive: true });
  mkdirSync(join(bundle, "app/assets/brand/png"), { recursive: true });
  mkdirSync(bin);
  for (const file of ["nowplaying", "runtime/node"]) {
    writeFileSync(join(bundle, file), "#!/bin/sh\nprintf x64\n"); chmodSync(join(bundle, file), 0o755);
  }
  writeFileSync(join(bundle, "app/assets/brand/png/icon-512.png"), "test");
  writeFileSync(join(bin, "rpmbuild"), '#!/bin/sh\ncp "$4" "$SPEC_CAPTURE"\n');
  chmodSync(join(bin, "rpmbuild"), 0o755);
  const capture = join(dir, "generated.spec");
  execFileSync("bash", [join(root, "scripts/build-linux-native.sh"), "rpm", bundle, "0.2.1+dev.abc123", join(dir, "out")], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SPEC_CAPTURE: capture } });
  const spec = readFileSync(capture, "utf8");
  assert.match(spec, /^%global debug_package %\{nil\}$/m);
  assert.match(spec, /^Version: 0\.2\.1\+dev\.abc123$/m);
  assert.match(spec, /^%changelog\n\* [A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4} rowkav09 - 0\.2\.1\+dev\.abc123-1\n- Package the prebuilt development bundle\./m);
});
