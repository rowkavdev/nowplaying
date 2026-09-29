import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { serializeSetupConfig } from "../src/setup-config.js";

// The Windows entry point's stop path (#780): a configured app started with
// --no-tray must still quit when the shutdown route is called, and
// `nowplaying stop` must drive the same quit. Runs the real entry point with
// a throwaway LOCALAPPDATA on Windows CI (the entry resolves its data folder
// with win32 path rules, so this is win32-only).
const ENTRY = fileURLToPath(new URL("../scripts/windows-entry.js", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 48200 + (process.pid % 1000);
const windows = { skip: process.platform !== "win32" };

function run(localAppData, args) {
  const env = { ...process.env, LOCALAPPDATA: localAppData, NOWPLAYING_PORT: String(PORT) };
  const child = spawn(process.execPath, [ENTRY, ...args], { env, cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  return { child, exited, output: () => ({ stdout, stderr }) };
}

// A configured app without a reachable media server or OS keychain can still
// start in safe mode (crash-loop recovery, #122): safe mode skips the
// provider and credential paths, which also makes it the honest way to run
// the real entry point on CI. The shutdown route and no-tray quit wiring are
// the same in either mode.
async function configuredApp() {
  const localAppData = await mkdtemp(join(tmpdir(), "np-win-shutdown-"));
  const dir = join(localAppData, "nowplaying");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "config.json"), serializeSetupConfig({
    provider: "jellyfin", serverUrl: "http://127.0.0.1:9", identity: { id: `ci-${process.pid}`, displayName: "CI" }, credentialStored: true,
  }));
  await writeFile(join(dir, "startup-recovery.json"), JSON.stringify({ version: 1, failures: 3, subsystem: "provider" }));
  return localAppData;
}

async function waitForUrl(cli) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`start did not come up: ${JSON.stringify(cli.output())}`)), 30000);
    cli.child.stdout.on("data", () => {
      const match = cli.output().stdout.match(/Card: (http:\/\/127\.0\.0\.1:\d+)\/card\.svg/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    cli.exited.then((code) => { clearTimeout(timer); reject(new Error(`start exited ${code}: ${JSON.stringify(cli.output())}`)); });
  });
}

test("start --no-tray quits when the shutdown route is called (#780)", windows, async () => {
  const localAppData = await configuredApp();
  const cli = run(localAppData, ["start", "--no-tray"]);
  try {
    await waitForUrl(cli);
    const secret = (await readFile(join(localAppData, "nowplaying", "shutdown-token"), "utf8")).trim();
    assert.match(secret, /^[A-Za-z0-9_-]{8,128}$/);
    const wrong = await fetch(`http://127.0.0.1:${PORT}/api/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${"x".repeat(secret.length)}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(wrong.status, 401);
    const right = await fetch(`http://127.0.0.1:${PORT}/api/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(right.status, 202);
    assert.equal(await cli.exited, 0, "the no-tray app must exit after accepting a stop");
  } finally {
    cli.child.kill("SIGTERM");
    await cli.exited;
  }
});

test("`stop` asks the running no-tray app to quit and reports the outcome (#780)", windows, async () => {
  const localAppData = await configuredApp();
  const cli = run(localAppData, ["start", "--no-tray"]);
  try {
    await waitForUrl(cli);
    const stop = run(localAppData, ["stop"]);
    assert.equal(await stop.exited, 0, JSON.stringify(stop.output()));
    assert.match(stop.output().stdout, /stopped/i);
    assert.equal(await cli.exited, 0);
  } finally {
    cli.child.kill("SIGTERM");
    await cli.exited;
  }
});

test("`stop` with nothing running exits 3", windows, async () => {
  const localAppData = await mkdtemp(join(tmpdir(), "np-win-shutdown-"));
  const stop = run(localAppData, ["stop"]);
  assert.equal(await stop.exited, 3);
});
