import { open } from "node:fs/promises";

// Reads the newest events from the app log for the local Logs page (#253).
// Only the last maxBytes are read, and each line is checked again against the
// log's own shape, so nothing but time, level, component, status and code can
// reach the page even if the file was edited by hand.

const LEVELS = new Set(["info", "warn", "error"]);
const COMPONENTS = new Set(["startup", "provider", "discord", "updater", "tray"]);
const STATUSES = new Set(["starting", "ok", "idle", "degraded", "failed", "stopped"]);
const CODE = /^[A-Z][A-Z0-9_]{0,47}$/;

export function parseLogLine(line) {
  let value;
  try { value = JSON.parse(line); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const time = typeof value.time === "string" ? new Date(value.time) : null;
  if (!time || !Number.isFinite(time.getTime())) return null;
  if (!LEVELS.has(value.level) || !COMPONENTS.has(value.component) || !STATUSES.has(value.status)) return null;
  if (value.code !== undefined && (typeof value.code !== "string" || !CODE.test(value.code))) return null;
  return Object.freeze({ time: time.toISOString(), level: value.level, component: value.component, status: value.status, ...(value.code ? { code: value.code } : {}) });
}

export async function readLogTail(file, { maxLines = 200, maxBytes = 64 * 1024 } = {}) {
  if (typeof file !== "string" || !file) return [];
  let handle;
  try { handle = await open(file, "r"); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const lines = buffer.toString("utf8").split("\n");
    // The first line may be cut off when only part of the file was read.
    if (length < size) lines.shift();
    return lines.map((line) => line.trim()).filter(Boolean).map(parseLogLine).filter(Boolean).slice(-maxLines);
  } finally {
    await handle.close();
  }
}
