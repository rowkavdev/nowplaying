import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { cp, mkdtemp, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Collision regression for the dev-build smoke (#673 review): the probe
// must use a freshly assigned port and must verify the answering process
// is the bundle's own child, so a stray listener on the previously
// hardcoded port 47839 can neither fake readiness nor block a real one.

const root = fileURLToPath(new URL("..", import.meta.url));
const smoke = join(root, "scripts", "smoke-bundle.sh");

const hasTools = process.platform !== "win32" &&
  ["bash", "curl", "lsof"].every((tool) => spawnSync("sh", ["-c", `command -v ${tool}`], { stdio: "ignore" }).status === 0);

// A stand-in for a stray already-running instance: answers 200 on the
// previously hardcoded smoke port.
async function startDecoy() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<title>decoy</title>");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(47839, "127.0.0.1", resolve);
  });
  return server;
}

async function makeBundle({ healthy, infoFiles = true }) {
  const dir = await mkdtemp(join(tmpdir(), "nowplaying-smoke-"));
  const bundle = join(dir, "nowplaying");
  await mkdir(join(bundle, "runtime"), { recursive: true });
  await mkdir(join(bundle, "app"), { recursive: true });
  await symlink(process.execPath, join(bundle, "runtime", "node"));
  if (healthy) {
    // Copy the app like the real build does: Node resolves import.meta.url
    // through symlinked module paths, so a symlinked src would let the Info
    // handler find the checkout's own NOTICE/README.md/LICENSE and the
    // missing-packaged-files case below could never fail. Only
    // node_modules stays a symlink (module resolution walks up to it).
    await cp(join(root, "src"), join(bundle, "app", "src"), { recursive: true });
    await cp(join(root, "scripts"), join(bundle, "app", "scripts"), { recursive: true });
    await symlink(join(root, "node_modules"), join(bundle, "app", "node_modules"));
    await cp(join(root, "package.json"), join(bundle, "app", "package.json"));
    if (infoFiles) {
      // Mirroring the build: the Info modal files ship alongside app/src.
      for (const name of ["NOTICE", "README.md", "LICENSE"]) {
        await cp(join(root, name), join(bundle, "app", name));
      }
    }
  } else {
    // --version/--help succeed, but "start" dies immediately: the bundle
    // can never serve, however convincingly something else answers.
    await mkdir(join(bundle, "app", "scripts"), { recursive: true });
    await writeFile(
      join(bundle, "app", "scripts", "nowplaying.js"),
      'if (process.argv[2] === "start") process.exit(1);\nconsole.log("ok");\n',
    );
  }
  await writeFile(
    join(bundle, "nowplaying"),
    '#!/bin/sh\nhere=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$here/runtime/node" "$here/app/scripts/nowplaying.js" "$@"\n',
    { mode: 0o755 },
  );
  return bundle;
}

test("a dead bundle fails the smoke even while a decoy serves the old hardcoded port", { skip: !hasTools, timeout: 60000 }, async () => {
  const decoy = await startDecoy();
  try {
    const bundle = await makeBundle({ healthy: false });
    const run = spawnSync("bash", [smoke, bundle], { encoding: "utf8" });
    assert.notEqual(run.status, 0, `smoke accepted a dead bundle:\n${run.stdout}\n${run.stderr}`);
  } finally {
    decoy.close();
  }
});

test("a healthy bundle passes the smoke while the decoy is up", { skip: !hasTools, timeout: 60000 }, async () => {
  const decoy = await startDecoy();
  try {
    const bundle = await makeBundle({ healthy: true });
    const run = spawnSync("bash", [smoke, bundle], { encoding: "utf8" });
    assert.equal(run.status, 0, `smoke rejected a healthy bundle:\n${run.stdout}\n${run.stderr}`);
  } finally {
    decoy.close();
  }
});

test("a bundle missing the packaged Info files fails the smoke (#673 review)", { skip: !hasTools, timeout: 60000 }, async () => {
  const bundle = await makeBundle({ healthy: true, infoFiles: false });
  const run = spawnSync("bash", [smoke, bundle], { encoding: "utf8" });
  assert.notEqual(run.status, 0, `smoke accepted a bundle without app-level NOTICE/README.md/LICENSE:\n${run.stdout}\n${run.stderr}`);
});

// #683: the child-identity check must not hard-require lsof - minimal Linux
// containers lack it. With lsof off the PATH, the smoke verifies the child
// through /proc instead, in both directions.
const hasProc = process.platform === "linux";
const hasBasics = ["bash", "curl"].every((tool) => spawnSync("sh", ["-c", `command -v ${tool}`], { stdio: "ignore" }).status === 0);

async function pathWithoutLsof() {
  const dir = await mkdtemp(join(tmpdir(), "nowplaying-no-lsof-"));
  const bin = join(dir, "bin");
  await mkdir(bin);
  for (const source of ["/usr/bin", "/bin"]) {
    for (const name of await readdir(source)) {
      if (name === "lsof") continue;
      await symlink(join(source, name), join(bin, name)).catch(() => {});
    }
  }
  return bin;
}

test("without lsof, a healthy bundle passes and a dead bundle fails (Linux /proc fallback)", { skip: !(hasProc && hasBasics), timeout: 90000 }, async () => {
  const bin = await pathWithoutLsof();
  const env = { ...process.env, PATH: bin };
  const healthy = await makeBundle({ healthy: true });
  const good = spawnSync("bash", [smoke, healthy], { encoding: "utf8", env });
  assert.equal(good.status, 0, `healthy bundle rejected without lsof:\n${good.stdout}\n${good.stderr}`);
  const dead = await makeBundle({ healthy: false });
  const bad = spawnSync("bash", [smoke, dead], { encoding: "utf8", env });
  assert.notEqual(bad.status, 0, "dead bundle accepted without lsof");
});
