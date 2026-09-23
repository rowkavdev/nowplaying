import { spawn } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { win32 } from "node:path";

// "Start with Windows" uses the same per-user Startup shortcut the installer's
// "Start nowplaying when I sign in" task creates ({userstartup}\nowplaying.lnk),
// so the wizard and the installer share one entry: nowplaying never starts
// twice, and uninstalling removes it.

export function windowsStartupShortcutPath({ appData } = {}) {
  if (typeof appData !== "string" || !appData.trim()) throw new TypeError("APPDATA is required");
  return win32.join(win32.resolve(appData), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "nowplaying.lnk");
}

// Paths reach PowerShell through environment variables, never the script text,
// so a folder name can't be read as code.
const CREATE_SHORTCUT = [
  "$ErrorActionPreference = 'Stop'",
  "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $env:NP_SHORTCUT) | Out-Null",
  "$link = (New-Object -ComObject WScript.Shell).CreateShortcut($env:NP_SHORTCUT)",
  "$link.TargetPath = $env:NP_TARGET",
  "$link.Arguments = 'start'",
  "$link.WorkingDirectory = $env:NP_WORKDIR",
  "$link.Save()",
].join("; ");

export function runPowerShell(script, env, { spawnProcess = spawn, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      env: { ...process.env, ...env }, shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    });
    let errors = "";
    const timer = setTimeout(() => { child.kill?.(); reject(new Error("PowerShell timed out")); }, timeoutMs);
    child.stderr?.on("data", (chunk) => { errors += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`PowerShell exited ${code}: ${errors.trim().slice(0, 500)}`));
    });
  });
}

export function createWindowsStartup({ appData, exePath, run = runPowerShell } = {}) {
  const shortcut = windowsStartupShortcutPath({ appData });
  if (typeof exePath !== "string" || !win32.isAbsolute(exePath) || !/\.exe$/i.test(exePath)) throw new TypeError("exePath must be an absolute .exe path");
  return Object.freeze({
    shortcut,
    async isEnabled() {
      try { await access(shortcut); return true; }
      catch (error) { if (error?.code === "ENOENT") return false; throw error; }
    },
    async setEnabled(enabled) {
      if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean");
      if (!enabled) { await rm(shortcut, { force: true }); return; }
      await run(CREATE_SHORTCUT, { NP_SHORTCUT: shortcut, NP_TARGET: exePath, NP_WORKDIR: win32.dirname(exePath) });
    },
  });
}
