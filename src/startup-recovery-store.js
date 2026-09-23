import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { confirmHealthyStartup, createStartupRecoveryState, recordStartupFailure } from "./startup-recovery.js";

const MAX_STATE_BYTES = 4 * 1024;

// Crash-loop state on disk (#122). A bad or missing file is treated as a clean
// start: recovery must never be the thing that stops the app from starting.
export function createStartupRecoveryStore({ file } = {}) {
  if (typeof file !== "string" || !file) throw new TypeError("startup recovery file is required");
  async function load() {
    try {
      const text = await readFile(file, "utf8");
      if (Buffer.byteLength(text) > MAX_STATE_BYTES) return createStartupRecoveryState();
      return createStartupRecoveryState(JSON.parse(text));
    } catch {
      return createStartupRecoveryState();
    }
  }
  async function save(state) {
    const current = createStartupRecoveryState(state);
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, failures: current.failures, subsystem: current.subsystem })}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
    return current;
  }
  return Object.freeze({ load, save });
}

// Maps a startup error to the subsystem that failed.
export function startupFailureSubsystem(error) {
  const code = String(error?.startupCode ?? "");
  if (code.startsWith("CONFIG_")) return "configuration";
  if (code.startsWith("CREDENTIAL_") || code.startsWith("PROVIDER_")) return "provider";
  if (code.startsWith("DISCORD_")) return "discord";
  if (code.startsWith("UPDATE")) return "updater";
  return "unknown";
}

// Runs one app start under crash-loop protection. The attempt is counted as a
// failure *before* starting, so a hard crash (process killed, native fault)
// still counts; it is cleared once the app has stayed up for healthyAfterMs.
// After three unconfirmed starts in a row, start() is called with safeMode.
// Wiring into the Windows entry point and the tray comes in a follow-up.
export async function guardStartup({ store, start, healthyAfterMs = 60_000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof store?.load !== "function" || typeof store?.save !== "function") throw new TypeError("store is invalid");
  if (typeof start !== "function") throw new TypeError("start is required");
  const before = await store.load();
  const safeMode = before.safeMode;
  await saveQuietly(store, recordStartupFailure(before, before.subsystem ?? "unknown"));
  let app;
  try {
    app = await start({ safeMode, recovery: before });
  } catch (error) {
    await saveQuietly(store, recordStartupFailure(before, startupFailureSubsystem(error)));
    throw error;
  }
  // Safe mode stays on until the user picks "retry normal startup": a safe-mode
  // run staying up proves nothing about the parts it turned off.
  const timer = safeMode ? null : setTimer(() => saveQuietly(store, confirmHealthyStartup(before, true)), healthyAfterMs);
  timer?.unref?.();
  return Object.freeze({
    app, safeMode, recovery: before,
    cancel: () => { if (timer) clearTimer(timer); },
    retryNormal: () => saveQuietly(store, confirmHealthyStartup(before, true)),
  });
}

async function saveQuietly(store, state) {
  try { await store.save(state); } catch { /* a read-only disk must not block startup */ }
}
