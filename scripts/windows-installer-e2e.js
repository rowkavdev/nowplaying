// Windows installer end-to-end check for the guide's install path (#142
// phase 2). Silent-installs the built setup exe into a throwaway directory,
// proves the installed layout and startup shortcut, launches the installed
// app and probes its WebUI, then silent-uninstalls and proves removal.
// Emits the same machine-visible JSONL step shape as scripts/guide-paths.js
// (path "windows-install") and exits non-zero on the first broken step.
// win32-only: the guide-drift workflow runs it on windows-latest.
// Guard test: test/guide-paths-installer-e2e.test.js.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "win32") {
  console.error("windows-installer-e2e.js: runs on Windows only (the guide-drift workflow's windows-installer-e2e job)");
  process.exit(2);
}
const setup = process.argv[2] ? resolve(process.argv[2]) : null;
if (!setup) {
  console.error("usage: node scripts/windows-installer-e2e.js <path-to-setup.exe>");
  process.exit(2);
}

const steps = [];
async function step(id, fn) {
  try {
    await fn();
    steps.push({ path: "windows-install", step: id, status: "pass" });
    return true;
  } catch (error) {
    steps.push({ path: "windows-install", step: id, status: "fail", detail: String(error?.message ?? error) });
    return false;
  }
}
function expect(condition, detail) {
  if (!condition) throw new Error(detail);
}
function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}: ${(err || out).slice(0, 300)}`)));
  });
}
async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}
async function ephemeralPort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, "127.0.0.1", done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}
async function getOk(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) return;
    } catch { /* not up yet */ }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${url}`);
    await new Promise((done) => setTimeout(done, 500));
  }
}

const root = await mkdtemp(join(tmpdir(), "np-installer-e2e-"));
const installDir = join(root, "install");
const appData = join(root, "appdata");
const startupShortcut = join(homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "nowplaying.lnk");
let child = null;
try {
  if (await step("silent-install", async () => {
    await run(setup, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", `/DIR=${installDir}`, "/TASKS=startup", `/LOG=${join(root, "install.log")}`]);
  }))
  if (await step("installed-layout", async () => {
    for (const file of ["nowplaying.exe", "nowplayingw.exe", join("runtime", "node.exe"), join("app", "package.json"), join("app", "build-info.json"), "LICENSE", "unins000.exe"])
      expect(await exists(join(installDir, file)), `installed copy is missing ${file}`);
  }))
  if (await step("startup-shortcut", async () => {
    expect(await exists(startupShortcut), "the startup task must create the sign-in shortcut");
  }))
  if (await step("first-launch", async () => {
    const port = await ephemeralPort();
    child = spawn(join(installDir, "nowplaying.exe"), ["start", "--no-tray", "--no-setup"], {
      env: { ...process.env, LOCALAPPDATA: appData, NOWPLAYING_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    child.on("error", () => {});
    await getOk(`http://127.0.0.1:${port}/settings`);
  }))
  await step("silent-uninstall", async () => {
    child?.kill();
    child = null;
    await run(join(installDir, "unins000.exe"), ["/VERYSILENT", "/NORESTART"]);
    const deadline = Date.now() + 60000;
    while ((await exists(join(installDir, "nowplaying.exe"))) && Date.now() < deadline)
      await new Promise((done) => setTimeout(done, 1000));
    expect(!(await exists(join(installDir, "nowplaying.exe"))), "uninstall must remove the installed app");
    expect(!(await exists(startupShortcut)), "uninstall must remove the sign-in shortcut");
  });
} finally {
  child?.kill();
  await rm(root, { recursive: true, force: true });
}

for (const s of steps) console.log(JSON.stringify(s));
const failed = steps.filter((s) => s.status === "fail").length;
console.log(JSON.stringify({ path: "windows-install", status: failed ? "fail" : "pass", passed: steps.length - failed, failed }));
if (failed) process.exitCode = 1;
