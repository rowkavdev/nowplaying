import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Keep the process alive until taskkill can see its children. Killing only the
// .NET launcher could otherwise leave a hung bundled node.exe behind on CI.
function killProcessTree(child) {
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5_000, stdio: "ignore" });
  }
  child.kill("SIGKILL");
}

function runLauncher(bundle, name, argument, env, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(join(bundle, name), [argument], { cwd: bundle, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      killProcessTree(child);
      reject(new Error(`${name} ${argument} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    // Diagnostics stay bounded even if a broken command writes continuously.
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-16_384); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16_384); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${name} ${argument} exited with ${code ?? signal}: ${stderr.trim() || stdout.trim()}`));
      else resolveRun(stdout);
    });
  });
}

export async function smokeWindowsBundle(bundlePath, { timeoutMs = 30_000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
  const bundle = resolve(bundlePath);
  const { version } = JSON.parse(readFileSync(join(bundle, "app", "package.json"), "utf8"));
  if (typeof version !== "string" || !version) throw new Error("The bundled app/package.json has no version");
  const work = mkdtempSync(join(tmpdir(), "np-windows-runtime-"));
  const dotnetRoot = join(work, "empty-dotnet");
  mkdirSync(dotnetRoot);
  try {
    const env = {
      ...process.env,
      // A real, empty directory prevents installed SDKs/runtimes on the build
      // runner from rescuing an accidentally framework-dependent launcher.
      DOTNET_ROOT: dotnetRoot,
      DOTNET_ROOT_X64: dotnetRoot,
      DOTNET_MULTILEVEL_LOOKUP: "0",
      DOTNET_DISABLE_GUI_ERRORS: "1",
      // Force fresh extraction so an older cached runtime cannot mask missing
      // native libraries in the single-file bundle.
      DOTNET_BUNDLE_EXTRACT_BASE_DIR: join(work, "extracted-runtime"),
    };
    const actualVersion = await runLauncher(bundle, "nowplaying.exe", "--version", env, timeoutMs);
    if (actualVersion.trim() !== version) throw new Error(`nowplaying.exe --version returned ${JSON.stringify(actualVersion.trim())}; expected ${JSON.stringify(version)}`);
    const help = await runLauncher(bundle, "nowplaying.exe", "--help", env, timeoutMs);
    if (!/^Usage: nowplaying\.exe start\b/m.test(help)) throw new Error("nowplaying.exe --help did not return the app's usage text");
    // The GUI launcher deliberately discards stdout; its child exit code still
    // proves --version ran and completed. A modal startup error is time-bounded.
    await runLauncher(bundle, "nowplayingw.exe", "--version", env, timeoutMs);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error("Usage: node scripts/windows-bundle-smoke.js <bundle-dir>");
    await smokeWindowsBundle(process.argv[2]);
    console.log("Windows bundle: console --version/--help and GUI --version passed without installed .NET.");
  } catch (error) {
    console.error(`Windows bundle smoke test failed: ${error.message}`);
    process.exitCode = 1;
  }
}
