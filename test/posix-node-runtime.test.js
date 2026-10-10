import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const checker = join(root, "scripts/check-linux-node-runtime.sh");
const supported = process.platform === "linux" && ["cc", "readelf"].every((tool) => spawnSync(tool, ["--version"]).status === 0);
const linuxTools = { skip: !supported && "Linux cc and readelf are required" };

function executable(dir, dependency = null) {
  const source = join(dir, "runtime.c");
  const binary = join(dir, dependency ? "shared-runtime" : "standalone-runtime");
  if (dependency) {
    const librarySource = join(dir, "library.c");
    writeFileSync(librarySource, "int fixture_node(void) { return 0; }\n");
    execFileSync("cc", ["-shared", "-fPIC", `-Wl,-soname,${dependency}`, "-o", join(dir, dependency), librarySource]);
    writeFileSync(source, "extern int fixture_node(void); int main(void) { return fixture_node(); }\n");
    execFileSync("cc", [source, `-L${dir}`, `-l:${dependency}`, `-Wl,-rpath,${dir}`, "-o", binary]);
  } else {
    writeFileSync(source, '#include <stdio.h>\nint main(void) { puts("standalone fixture"); return 0; }\n');
    execFileSync("cc", [source, "-o", binary]);
  }
  return binary;
}

test("Linux runtime check accepts standard libc but rejects real ELF libnode and extra runtime dependencies", linuxTools, () => {
  const dir = mkdtempSync(join(tmpdir(), "np-node-runtime-"));
  const standalone = executable(dir);
  assert.equal(spawnSync("bash", [checker, standalone], { encoding: "utf8" }).status, 0);
  for (const dependency of ["libnode.so.999", "libcrypto.so.999", "libz.so.999"]) {
    const binary = executable(dir, dependency);
    const result = spawnSync("bash", [checker, binary], { encoding: "utf8" });
    assert.equal(result.status, 2, dependency);
    assert.ok(result.stderr.includes(dependency), result.stderr);
    assert.match(result.stderr, /NOWPLAYING_NODE_BINARY/);
  }
  const wrapper = join(dir, "wrapper");
  writeFileSync(wrapper, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const rejected = spawnSync("bash", [checker, wrapper], { encoding: "utf8" });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /ELF executable/);
});

function buildFixture() {
  const dir = mkdtempSync(join(tmpdir(), "np-posix-runtime-build-"));
  for (const folder of ["scripts", "src", "assets", "node_modules", "dist/linux"]) mkdirSync(join(dir, folder), { recursive: true });
  for (const file of ["scripts/build-posix.sh", "scripts/check-linux-node-runtime.sh", "scripts/write-posix-build-info.js", "src/build-provenance.js", "NOTICE", "README.md", "LICENSE"]) copyFileSync(join(root, file), join(dir, file));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module", version: "0.2.0" }));
  // This fixture checks build input selection/copying; the real launcher
  // smoke has its own integration suite with the actual application.
  writeFileSync(join(dir, "scripts/smoke-bundle.sh"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(dir, "dist/linux/existing-output"), "preserve me");
  return dir;
}

test("POSIX build honors an explicit standalone runtime and preserves prior output on rejected runtime", linuxTools, () => {
  const dir = buildFixture();
  const shared = executable(dir, "libnode.so.999");
  const env = { ...process.env, GITHUB_SHA: "1".repeat(40), NOWPLAYING_NODE_BINARY: shared };
  const rejected = spawnSync("bash", [join(dir, "scripts/build-posix.sh"), "linux"], { cwd: dir, env, encoding: "utf8" });
  assert.equal(rejected.status, 2, rejected.stderr);
  assert.match(rejected.stderr, /libnode\.so\.999/);
  assert.equal(readFileSync(join(dir, "dist/linux/existing-output"), "utf8"), "preserve me");
  const standalone = executable(dir);
  const built = spawnSync("bash", [join(dir, "scripts/build-posix.sh"), "linux"], { cwd: dir, env: { ...env, NOWPLAYING_NODE_BINARY: standalone }, encoding: "utf8" });
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
  assert.deepEqual(readFileSync(join(dir, "dist/linux/nowplaying/runtime/node")), readFileSync(standalone));
  assert.equal(JSON.parse(readFileSync(join(dir, "dist/linux/nowplaying/app/build-info.json"), "utf8")).commitSha, "1".repeat(40));
});
