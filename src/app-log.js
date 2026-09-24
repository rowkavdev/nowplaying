import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, win32 } from "node:path";

const LEVELS = new Set(["info", "warn", "error"]);
const COMPONENTS = new Set(["startup", "provider", "discord", "updater", "tray"]);
const STATUSES = new Set(["starting", "ok", "idle", "degraded", "failed", "stopped"]);

export function windowsLogPath({ localAppData, appName = "nowplaying" } = {}) {
  if (typeof localAppData !== "string" || !localAppData.trim()) throw new TypeError("LOCALAPPDATA is required");
  if (!/^[A-Za-z0-9._-]+$/.test(appName)) throw new TypeError("appName is invalid");
  return win32.join(win32.resolve(localAppData), appName, "logs", "nowplaying.log");
}

export function windowsLogFolder(options = {}) {
  return win32.dirname(windowsLogPath(options));
}

export function serializeLogEvent({ time, level, component, status, code = null } = {}) {
  if (!(time instanceof Date) || !Number.isFinite(time.getTime())) throw new TypeError("log time is invalid");
  if (!LEVELS.has(level) || !COMPONENTS.has(component) || !STATUSES.has(status)) throw new TypeError("log event is invalid");
  if (code !== null && (typeof code !== "string" || !/^[A-Z][A-Z0-9_]{0,47}$/.test(code))) throw new TypeError("log code is invalid");
  return `${JSON.stringify({ time: time.toISOString(), level, component, status, ...(code ? { code } : {}) })}\n`;
}

export function createRotatingLog({ file, maxBytes = 1024 * 1024, retain = 3 } = {}) {
  if (typeof file !== "string" || !file) throw new TypeError("log file is required");
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 50 * 1024 * 1024) throw new TypeError("log maxBytes is invalid");
  if (!Number.isInteger(retain) || retain < 1 || retain > 10) throw new TypeError("log retain is invalid");

  async function write(event) {
    const line = serializeLogEvent(event);
    if (Buffer.byteLength(line) > maxBytes) throw new Error("log entry exceeds maxBytes");
    await mkdir(dirname(file), { recursive: true });
    const currentSize = await stat(file).then((value) => value.size, (error) => error.code === "ENOENT" ? 0 : Promise.reject(error));
    if (currentSize > 0 && currentSize + Buffer.byteLength(line) > maxBytes) await rotate();
    await appendFile(file, line, { encoding: "utf8", mode: 0o600 });
  }

  async function rotate() {
    await rm(`${file}.${retain}`, { force: true });
    for (let index = retain - 1; index >= 1; index -= 1) {
      try { await rename(`${file}.${index}`, `${file}.${index + 1}`); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    try { await rename(file, `${file}.1`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }

  return Object.freeze({ file, write });
}


// `file` picks the log explicitly (the Linux/macOS entry passes appPaths().logFile);
// without it only Windows logs, to %LOCALAPPDATA%.
export function createAppLogger({ env = process.env, platform = process.platform, now = () => new Date(), createLog = createRotatingLog, file = null } = {}) {
  let log = null;
  if (typeof file === "string" && file) {
    try { log = createLog({ file }); }
    catch { log = null; }
  } else if (platform === "win32" && typeof env?.LOCALAPPDATA === "string" && env.LOCALAPPDATA.trim()) {
    try { log = createLog({ file: windowsLogPath({ localAppData: env.LOCALAPPDATA }) }); }
    catch { log = null; }
  }
  let failures = 0;

  async function event(component, status, { level = "info", code = null } = {}) {
    if (!log) return false;
    try {
      await log.write({ time: now(), level, component, status, code });
      return true;
    } catch {
      failures += 1;
      return false;
    }
  }

  return Object.freeze({ enabled: Boolean(log), event, failures: () => failures });
}
