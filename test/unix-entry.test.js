import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createCredentialStore } from "../src/credential-store.js";
import { createLinuxCredentialAdapter } from "../src/linux-credential-adapter.js";
import { serializeSetupConfig } from "../src/setup-config.js";

// The Linux/macOS entry point (#215), run for real with a throwaway HOME.
// First run serves the WebUI without touching the keychain until sign-in.
const ENTRY = fileURLToPath(new URL("../scripts/nowplaying.js", import.meta.url));
const unix = { skip: process.platform === "win32" };

function run(home, args) {
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: "", XDG_STATE_HOME: "" };
  const child = spawn(process.execPath, [ENTRY, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  return { child, exited, output: () => ({ stdout, stderr }) };
}

test("--version prints the package version", unix, async () => {
  const home = await mkdtemp(join(tmpdir(), "np-unix-"));
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const cli = run(home, ["--version"]);
  assert.equal(await cli.exited, 0);
  assert.equal(cli.output().stdout.trim(), version);
});

test("start --no-setup with no config serves WebUI Settings on loopback", unix, async () => {
  const home = await mkdtemp(join(tmpdir(), "np-unix-"));
  const cli = run(home, ["start", "--no-setup"]);
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
  for (const args of [["bogus"], ["start", "--no-tray"], ["setup"]]) {
    const cli = run(home, args);
    assert.equal(await cli.exited, 2, args.join(" "));
  }
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
  const missing = run(home, ["start", "--no-setup"]);
  assert.equal(await missing.exited, 1);
  assert.match(missing.output().stderr, /sign in again/);

  await store.save({ provider: "jellyfin", identityId }, "ci-token");
  const cli = run(home, ["start", "--no-setup"]);
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
  for (const args of [["start", "--no-setup"]]) {
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
