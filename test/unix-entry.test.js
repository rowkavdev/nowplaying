import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createCredentialStore } from "../src/credential-store.js";
import { createLinuxCredentialAdapter } from "../src/linux-credential-adapter.js";
import { serializeSetupConfig } from "../src/setup-config.js";
import { appPaths } from "../src/app-paths.js";

// The Linux/macOS entry point (#215), run for real with a throwaway HOME.
// First run serves the WebUI without touching the keychain until sign-in.
const ENTRY = fileURLToPath(new URL("../scripts/nowplaying.js", import.meta.url));
const unix = { skip: process.platform === "win32" };

function recoveryPath(home) {
  return join(dirname(appPaths({ home, env: {} }).configFile), "startup-recovery.json");
}

function run(home, args, extraEnv = {}) {
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: "", XDG_STATE_HOME: "", ...extraEnv };
  const child = spawn(process.execPath, [ENTRY, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  return { child, exited, output: () => ({ stdout, stderr }) };
}

async function unusedPort() {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitForOutput(cli, pattern) {
  for (let count = 0; count < 200; count++) {
    if (pattern.test(cli.output().stdout)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Expected ${pattern}: ${JSON.stringify(cli.output())}`);
}

test("a second desktop launch reopens the existing app; headless duplicates never open a browser or count as crashes", { ...unix, timeout: 15000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "np-unix-duplicate-"));
  const bin = join(home, "bin");
  await mkdir(bin);
  const marker = join(home, "opened-url");
  await writeFile(join(bin, "xdg-open"), `#!/bin/sh\nprintf '%s' "$1" > '${marker}'\n`, { mode: 0o755 });
  const port = await unusedPort();
  const env = { NOWPLAYING_PORT: String(port), PATH: `${bin}:${process.env.PATH}` };
  const running = run(home, ["start", "--no-setup", "--no-tray"], env);
  try {
    await waitForOutput(running, /NowPlaying Settings:/);
    const recoveryFile = recoveryPath(home);
    const before = await readFile(recoveryFile, "utf8");
    for (let attempt = 0; attempt < 4; attempt++) {
      const duplicate = run(home, ["start", "--no-setup", "--no-tray"], env);
      assert.equal(await duplicate.exited, 0);
      assert.match(duplicate.output().stdout, /already running/);
      assert.equal(duplicate.output().stderr, "");
    }
    await assert.rejects(readFile(marker, "utf8"), { code: "ENOENT" });
    assert.equal(await readFile(recoveryFile, "utf8"), before);
    const desktop = run(home, ["start", "--no-tray"], env);
    assert.equal(await desktop.exited, 0);
    if (process.platform === "linux") {
      let opened;
      for (let count = 0; count < 40; count++) {
        try { opened = await readFile(marker, "utf8"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
      }
      assert.equal(opened, `http://127.0.0.1:${port}/settings`);
    }
  } finally { running.child.kill("SIGTERM"); await running.exited; await rm(home, { recursive: true, force: true }); }
});

test("simultaneous launches keep one server and let the duplicate exit successfully", { ...unix, timeout: 15000 }, async () => {
  for (const previousFailures of [0, 2]) {
    const home = await mkdtemp(join(tmpdir(), "np-unix-race-"));
    await mkdir(dirname(recoveryPath(home)), { recursive: true });
    await writeFile(recoveryPath(home), JSON.stringify({ version: 1, failures: previousFailures, subsystem: "provider" }));
    const env = { NOWPLAYING_PORT: String(await unusedPort()) };
    const launches = [run(home, ["start", "--no-setup", "--no-tray"], env), run(home, ["start", "--no-setup", "--no-tray"], env)];
    try {
      const completed = await Promise.race(launches.map(async (cli, index) => ({ index, code: await cli.exited })));
      assert.equal(completed.code, 0, JSON.stringify(launches.map((cli) => cli.output())));
      assert.match(launches[completed.index].output().stdout, /already running/);
      const running = launches[1 - completed.index];
      await waitForOutput(running, /NowPlaying Settings:/);
      const recovery = JSON.parse(await readFile(recoveryPath(home), "utf8"));
      assert.equal(recovery.failures, previousFailures + 1, "only the winning process adds one pending startup to the existing history");
      assert.equal((await fetch(`http://127.0.0.1:${env.NOWPLAYING_PORT}/settings`)).status, 200);
    } finally {
      for (const cli of launches) cli.child.kill("SIGTERM");
      await Promise.all(launches.map((cli) => cli.exited));
      await rm(home, { recursive: true, force: true });
    }
  }
});

test("an unrelated listener remains a port conflict and never opens its page", { ...unix, timeout: 10000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "np-unix-unrelated-"));
  const listener = createServer((socket) => {
    // The identity probe can close the rejected connection before this reply
    // drains; macOS reports that expected peer reset on the accepted socket.
    socket.on("error", (error) => assert.equal(error.code, "ECONNRESET"));
    socket.on("data", () => socket.end('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{"app":"NowPlaying","proof":"made-up"}'));
  });
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const { port } = listener.address();
  try {
    const cli = run(home, ["start", "--no-setup", "--no-tray"], { NOWPLAYING_PORT: String(port) });
    assert.equal(await cli.exited, 1);
    assert.match(cli.output().stderr, /already in use/);
    assert.doesNotMatch(cli.output().stdout, /already running/);
  } finally { await new Promise((resolve) => listener.close(resolve)); await rm(home, { recursive: true, force: true }); }
});

test("--version prints the package version", unix, async () => {
  const home = await mkdtemp(join(tmpdir(), "np-unix-"));
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const cli = run(home, ["--version"]);
  assert.equal(await cli.exited, 0);
  assert.equal(cli.output().stdout.trim(), version);
});

test("start --no-setup with no config serves WebUI Settings on loopback", unix, async () => {
  const home = await mkdtemp(join(tmpdir(), "np-unix-"));
  const cli = run(home, ["start", "--no-setup", "--no-tray"], { NOWPLAYING_PORT: String(await unusedPort()) });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`WebUI did not come up: ${JSON.stringify(cli.output())}`)), 10000);
      cli.child.stdout.on("data", () => {
        const match = cli.output().stdout.match(/NowPlaying Settings: (http:\/\/127\.0\.0\.1:\d+\/settings)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      cli.exited.then((code) => { clearTimeout(timer); reject(new Error(`start exited ${code}: ${JSON.stringify(cli.output())}`)); });
    });
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /NowPlaying/);
    assert.equal((await (await fetch(new URL("/api/settings/servers", url))).json()).firstRun, true);
  } finally { cli.child.kill("SIGTERM"); await cli.exited; }
});

test("unknown commands and options exit 2", unix, async () => {
  const home = await mkdtemp(join(tmpdir(), "np-unix-"));
  for (const args of [["bogus"], ["start", "--bogus"], ["setup"]]) {
    const cli = run(home, args);
    assert.equal(await cli.exited, 2, args.join(" "));
  }
});

test("a damaged private instance identity reports recovery instructions without a stack trace", { ...unix, timeout: 10000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "np-unix-damaged-instance-"));
  try {
    await mkdir(dirname(recoveryPath(home)), { recursive: true });
    await writeFile(join(dirname(recoveryPath(home)), "desktop-instance-secret"), "broken");
    const cli = run(home, ["start", "--no-setup", "--no-tray"], { NOWPLAYING_PORT: String(await unusedPort()) });
    assert.equal(await cli.exited, 1);
    assert.match(cli.output().stderr, /identity is damaged.*Remove the desktop-instance-secret/);
    assert.doesNotMatch(cli.output().stderr, /at |desktop-instance\.js:|DesktopInstanceError:/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

// Needs a real Secret Service; CI runs it in the secret-service job.
const secretService = { skip: process.platform !== "linux" || process.env.NOWPLAYING_SECRET_SERVICE_TEST !== "1" };

test("start runs the server and card from the setup config and the real Secret Service", secretService, async () => {
  const home = await mkdtemp(join(tmpdir(), "np-unix-"));
  const identityId = `ci-${process.pid}-${Date.now()}`;
  const store = createCredentialStore({ adapter: createLinuxCredentialAdapter() });
  await mkdir(join(home, ".config", "nowplaying"), { recursive: true });
  await writeFile(join(home, ".config", "nowplaying", "config.json"), serializeSetupConfig({
    provider: "jellyfin", serverUrl: "http://127.0.0.1:9", identity: { id: identityId, displayName: "CI" }, credentialStored: true,
  }));
  const missing = run(home, ["start", "--no-setup", "--no-tray"]);
  assert.equal(await missing.exited, 1);
  assert.match(missing.output().stderr, /sign in again/);

  await store.save({ provider: "jellyfin", identityId }, "ci-token");
  const cli = run(home, ["start", "--no-setup", "--no-tray"], { NOWPLAYING_PORT: String(await unusedPort()) });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`start did not come up: ${JSON.stringify(cli.output())}`)), 30000);
      cli.child.stdout.on("data", () => {
        const match = cli.output().stdout.match(/Card: (http:\/\/127\.0\.0\.1:\d+)\/card\.svg/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      cli.exited.then((code) => { clearTimeout(timer); reject(new Error(`start exited ${code}: ${JSON.stringify(cli.output())}`)); });
    });
    const health = await fetch(`${url}/healthz`);
    assert.deepEqual([health.status, await health.text()], [200, "ok\n"]);
    // There's no media server at 127.0.0.1:9, so the card route answers with
    // its "unavailable" state; that still proves the card pipeline is wired up.
    const card = await fetch(`${url}/card.svg`);
    assert.equal(card.headers.has("x-nowplaying-source"), true);
    if (card.status === 200) assert.match(await card.text(), /^<svg/);
    else assert.deepEqual([card.status, card.headers.get("x-nowplaying-source")], [503, "unavailable"]);
    assert.doesNotMatch(JSON.stringify(cli.output()), /ci-token/);
    const log = await readFile(join(home, ".local", "state", "nowplaying", "logs", "nowplaying.log"), "utf8");
    assert.match(log, /"status":"starting"/);
  } finally {
    cli.child.kill("SIGTERM");
    await cli.exited;
    await store.remove({ provider: "jellyfin", identityId });
  }
});

test("start and setup without HOME say so plainly, no stack trace (#500)", unix, async () => {
  for (const args of [["start", "--no-setup", "--no-tray"]]) {
    const env = { ...process.env };
    delete env.HOME;
    const child = spawn(process.execPath, [ENTRY, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 1, args.join(" "));
    assert.match(stderr, /HOME is not set/);
    assert.doesNotMatch(stderr, /TypeError|app-paths\.js/);
  }
});

test("Linux first-run browser opener does not inherit unrelated exported secrets", { skip: process.platform !== "linux", timeout: 10000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), "np-first-run-env-"));
  const bin = join(home, "bin");
  await mkdir(bin);
  const marker = join(home, "opener-env.txt");
  await writeFile(join(bin, "xdg-open"), `#!/bin/sh\nprintf '%s' "\${GH_TOKEN-unset}" > '${marker}'\n`, { mode: 0o755 });
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(process.execPath, [ENTRY, "start", "--no-tray"], {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "", XDG_STATE_HOME: "", PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: "regression-fixture-not-a-secret", NOWPLAYING_PORT: String(port) },
    stdio: "ignore",
  });
  const exited = new Promise((resolve) => child.on("close", resolve));
  try {
    let output;
    for (let n = 0; n < 100; n++) {
      try { output = await readFile(marker, "utf8"); break; } catch (error) { if (error.code !== "ENOENT") throw error; }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(output, "unset");
  } finally { child.kill("SIGTERM"); await exited; await rm(home, { recursive: true, force: true }); }
});
