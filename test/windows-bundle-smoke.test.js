import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { smokeWindowsBundle } from "../scripts/windows-bundle-smoke.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);

// This child checks the isolation environment itself, records each invocation,
// then behaves like the app's version/help commands. Windows uses the actual
// compiled C# launchers; POSIX uses executable Node fixtures for failure tests.
function entry(mode = "ok") {
  return `import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
assert.equal(process.env.DOTNET_ROOT_X64, process.env.DOTNET_ROOT);
assert.deepEqual(readdirSync(process.env.DOTNET_ROOT), []);
assert.equal(process.env.DOTNET_MULTILEVEL_LOOKUP, '0');
assert.equal(process.env.DOTNET_DISABLE_GUI_ERRORS, '1');
assert.ok(process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR);
const log = join(root, 'entry-calls.log');
const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\\n') : [];
const command = process.argv[2];
const gui = calls.length === 2;
appendFileSync(log, command + '\\n');
if (${JSON.stringify(mode)} === 'bad-help' && command === '--help') process.exit(17);
if (${JSON.stringify(mode)} === 'bad-gui' && gui) process.exit(18);
if (${JSON.stringify(mode)} === 'gui-hang' && gui) {
  writeFileSync(join(root, 'hung-child.pid'), String(process.pid));
  setInterval(() => {}, 1000);
} else if (command === '--version') {
  console.log(${JSON.stringify(mode)} === 'wrong-version' ? '0.0.0-wrong' : '1.2.3');
} else if (command === '--help') console.log('Usage: nowplaying.exe start');
else process.exit(19);
`;
}

function tempFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "np-windows-bundle-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFixtureApp(bundle, mode = "ok") {
  mkdirSync(join(bundle, "app", "scripts"), { recursive: true });
  writeFileSync(join(bundle, "app", "package.json"), JSON.stringify({ type: "module", version: "1.2.3" }));
  writeFileSync(join(bundle, "app", "scripts", "windows-entry.js"), entry(mode));
  rmSync(join(bundle, "entry-calls.log"), { force: true });
}

test("bundle smoke verifies real child output, isolation, errors and GUI timeout", { skip: process.platform === "win32", timeout: 20_000 }, async (t) => {
  const bundle = tempFixture(t);
  writeFixtureApp(bundle);
  for (const name of ["nowplaying.exe", "nowplayingw.exe"]) {
    const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
    writeFileSync(join(bundle, name), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(bundle, "app", "scripts", "windows-entry.js"))} "$@"\n`, { mode: 0o755 });
  }
  await smokeWindowsBundle(bundle, { timeoutMs: 3_000 });
  assert.equal(readFileSync(join(bundle, "entry-calls.log"), "utf8"), "--version\n--help\n--version\n");
  for (const [mode, message] of [
    ["wrong-version", /--version returned.*0\.0\.0-wrong/],
    ["bad-help", /--help exited with 17/],
    ["bad-gui", /nowplayingw\.exe --version exited with 18/],
    ["gui-hang", /nowplayingw\.exe --version timed out/],
  ]) {
    writeFixtureApp(bundle, mode);
    await assert.rejects(smokeWindowsBundle(bundle, { timeoutMs: 3_000 }), message);
  }
});

test("Windows build ships standalone real launchers and rejects a framework-dependent EXE on an SDK runner", { skip: process.platform !== "win32", timeout: 420_000 }, async (t) => {
  const dir = tempFixture(t);
  for (const folder of ["scripts", "src", "assets", "node_modules", "tools"]) mkdirSync(join(dir, folder));
  for (const file of ["scripts/build-windows.ps1", "scripts/windows-launcher.cs", "scripts/windows-bundle-smoke.js", "scripts/windows-installer.iss"]) copyFileSync(join(root, file), join(dir, file));
  cpSync(join(root, "assets"), join(dir, "assets"), { recursive: true });
  for (const file of ["NOTICE", "LICENSE", "README.md"]) writeFileSync(join(dir, file), "fixture\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module", version: "1.2.3" }));
  writeFileSync(join(dir, "scripts", "windows-entry.js"), entry());
  writeFileSync(join(dir, "tools", "iscc.cmd"), "@exit /b 0\r\n");
  const env = { ...process.env, GITHUB_SHA: "a".repeat(40), PATH: `${join(dir, "tools")}${delimiter}${process.env.PATH}` };
  const buildArgs = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(dir, "scripts", "build-windows.ps1")];
  // Exercise the actual release script, including all publish flags and the
  // smoke it must pass before the installer/ZIP can be created.
  await exec("powershell.exe", buildArgs, { cwd: dir, env, windowsHide: true, timeout: 300_000, maxBuffer: 2 * 1024 * 1024 });
  const bundle = join(dir, "dist", "windows", "nowplaying-v1.2.3-windows-x64");
  assert.equal(readFileSync(join(bundle, "entry-calls.log"), "utf8"), "--version\n--help\n--version\n");
  assert.ok(existsSync(`${bundle}.zip`));
  for (const notice of ["LICENSE.TXT", "THIRD-PARTY-NOTICES.TXT"]) {
    const sourceNotice = readFileSync(join(dir, "dist", "launcher", "publish", "dotnet-notices", notice));
    assert.ok(sourceNotice.length > 0);
    assert.deepEqual(readFileSync(join(bundle, "licenses", "dotnet", notice)), sourceNotice);
  }
  const goodConsole = readFileSync(join(bundle, "nowplaying.exe"));

  await t.test("an installed SDK cannot hide a framework-dependent launcher", async () => {
    const dependent = join(dir, "dependent");
    execFileSync("dotnet", ["publish", join(dir, "dist", "launcher", "Launcher.csproj"), "--configuration", "Release", "--runtime", "win-x64", "--self-contained", "false", "-p:PublishSingleFile=true", "-p:UseAppHost=true", "-p:AssemblyName=dependent", "--output", dependent], { cwd: dir, env, windowsHide: true, timeout: 90_000, stdio: "pipe" });
    copyFileSync(join(dependent, "dependent.exe"), join(bundle, "nowplaying.exe"));
    writeFixtureApp(bundle);
    await assert.rejects(smokeWindowsBundle(bundle), /nowplaying\.exe --version exited with/);
    assert.equal(existsSync(join(bundle, "entry-calls.log")), false, "the .NET host must fail before reaching Node");
    writeFileSync(join(bundle, "nowplaying.exe"), goodConsole);
  });

  await t.test("real GUI launcher failures and hangs fail the smoke", async () => {
    writeFixtureApp(bundle, "bad-gui");
    await assert.rejects(smokeWindowsBundle(bundle), /nowplayingw\.exe --version exited with 18/);
    writeFixtureApp(bundle, "gui-hang");
    await assert.rejects(smokeWindowsBundle(bundle, { timeoutMs: 10_000 }), /nowplayingw\.exe --version timed out/);
    const hungChild = Number(readFileSync(join(bundle, "hung-child.pid"), "utf8"));
    assert.throws(() => process.kill(hungChild, 0), /ESRCH/, "a timed-out GUI must not leave its Node child behind");
  });

  await t.test("native publish setup failure stops the build before using stale output", async () => {
    // Use an actual EXE so PowerShell's executable/PATHEXT precedence cannot
    // select the runner's real dotnet.exe instead of the deliberate failure.
    writeFileSync(join(dir, "dist", "launcher", "Program.cs"), "return 23;\n");
    execFileSync("dotnet", ["publish", join(dir, "dist", "launcher", "Launcher.csproj"), "--configuration", "Release", "--runtime", "win-x64", "--self-contained", "false", "-p:PublishSingleFile=true", "-p:UseAppHost=true", "-p:AssemblyName=dotnet", "--output", join(dir, "tools")], { cwd: dir, env, windowsHide: true, timeout: 90_000, stdio: "pipe" });
    await assert.rejects(exec("powershell.exe", buildArgs, { cwd: dir, env, windowsHide: true, timeout: 30_000 }), (error) => {
      assert.match(error.stderr, /dotnet new failed with exit code 23/);
      return true;
    });
    assert.equal(existsSync(join(bundle, "nowplaying.exe")), false);
    assert.equal(existsSync(`${bundle}.zip`), false);
  });
});
