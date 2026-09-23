import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createCredentialStore } from "../src/credential-store.js";
import { serializeSetupConfig } from "../src/setup-config.js";
import { createWindowsCredentialAdapter } from "../src/windows-credential-adapter.js";

// Windows round trip: a config like the wizard writes, a sign-in in the real
// Credential Manager, then `start` (no argument) through the real entry point.
const ENTRY = fileURLToPath(new URL("../scripts/windows-entry.js", import.meta.url));
const windows = { skip: process.platform !== "win32" };

function runStart(localAppData, cwd, args = []) {
  const child = spawn(process.execPath, [ENTRY, "start", ...args], { cwd, env: { ...process.env, LOCALAPPDATA: localAppData }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  return { child, exited, output: () => ({ stdout, stderr }) };
}

test("start --no-setup with no config tells the user to run setup", windows, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-start-"));
  const run = runStart(dir, dir, ["--no-setup"]);
  assert.equal(await run.exited, 1);
  assert.match(run.output().stderr, /nowplaying\.exe setup/);
});

test("start rejects unknown options", windows, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-start-"));
  const run = runStart(dir, dir, ["--bogus"]);
  assert.equal(await run.exited, 2);
  assert.match(run.output().stderr, /unknown start option: --bogus/);
});

test("start runs from the wizard config and the real Credential Manager", windows, async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-start-"));
  const identityId = `ci-${process.pid}-${Date.now()}`;
  const store = createCredentialStore({ adapter: createWindowsCredentialAdapter() });
  await mkdir(join(dir, "nowplaying"), { recursive: true });
  await writeFile(join(dir, "nowplaying", "config.json"), serializeSetupConfig({
    provider: "jellyfin", serverUrl: "http://127.0.0.1:9", identity: { id: identityId, displayName: "CI" }, credentialStored: true,
  }));
  const missing = runStart(dir, dir);
  assert.equal(await missing.exited, 1);
  assert.match(missing.output().stderr, /sign in again/);

  await store.save({ provider: "jellyfin", identityId }, "ci-token");
  const run = runStart(dir, dir);
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`start did not come up: ${JSON.stringify(run.output())}`)), 30000);
      run.child.stdout.on("data", () => {
        const match = run.output().stdout.match(/Card: (http:\/\/127\.0\.0\.1:\d+)\/card\.svg/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      run.exited.then((code) => { clearTimeout(timer); reject(new Error(`start exited ${code}: ${JSON.stringify(run.output())}`)); });
    });
    const health = await fetch(`${url}/healthz`);
    assert.deepEqual([health.status, await health.text()], [200, "ok\n"]);
    assert.doesNotMatch(JSON.stringify(run.output()), /ci-token/);
  } finally {
    run.child.kill();
    await run.exited;
    await store.remove({ provider: "jellyfin", identityId });
  }
});
