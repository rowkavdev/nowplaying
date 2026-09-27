import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
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

async function makeBundle({ healthy }) {
  const dir = await mkdtemp(join(tmpdir(), "nowplaying-smoke-"));
  const bundle = join(dir, "nowplaying");
  await mkdir(join(bundle, "runtime"), { recursive: true });
  await mkdir(join(bundle, "app"), { recursive: true });
  await symlink(process.execPath, join(bundle, "runtime", "node"));
  if (healthy) {
    // Symlink the real app instead of copying node_modules - the launcher
    // resolves through the links exactly like the copied bundle.
    await symlink(join(root, "src"), join(bundle, "app", "src"));
    await symlink(join(root, "scripts"), join(bundle, "app", "scripts"));
    await symlink(join(root, "node_modules"), join(bundle, "app", "node_modules"));
    await symlink(join(root, "package.json"), join(bundle, "app", "package.json"));
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
