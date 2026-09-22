import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const LEVELS = new Set(["info", "warn", "error"]);
const COMPONENTS = new Set(["startup", "provider", "discord", "updater", "tray"]);
const STATUSES = new Set(["starting", "ok", "idle", "degraded", "failed", "stopped"]);

export function windowsLogPath({ localAppData, appName = "nowplaying" } = {}) {
  if (typeof localAppData !== "string" || !localAppData.trim()) throw new TypeError("LOCALAPPDATA is required");
  if (!/^[A-Za-z0-9._-]+$/.test(appName)) throw new TypeError("appName is invalid");
  return join(resolve(localAppData), appName, "logs", "nowplaying.log");
}

export function serializeLogEvent({ time, level, component, status, code = null } = {}) {
  if (!(time instanceof Date) || !Number.isFinite(time.getTime())) throw new TypeError("log time is invalid");
  if (!LEVELS.has(level) || !COMPONENTS.has(component) || !STATUSES.has(status)) throw new TypeError("log event is invalid");
  if (code !== null && (typeof code !== "string" || !/^[A-Z][A-Z0-9_]{0,47}$/.test(code))) throw new TypeError("log code is invalid");
  return `${JSON.stringify({ time: time.toISOString(), level, component, status, ...(code ? { code } : {}) })}\n`;
}

export function createRotatingLog({ file, maxBytes = 1024 * 1024, retain = 3 } = {}) {
  if (typeof file !== "string" || !file) throw new TypeError("log file is required");
  if (!Number.isInteger(maxBytes) || maxBytes < 256 || maxBytes > 50 * 1024 * 1024) throw new TypeError("log maxBytes is invalid");
  if (!Number.isInteger(retain) || retain < 1 || retain > 10) throw new TypeError("log retain is invalid");

  async function write(event) {
    const line = serializeLogEvent(event);
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
