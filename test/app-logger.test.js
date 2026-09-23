import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAppLogger } from "../src/app-log.js";

const TIME = new Date("2026-09-23T02:30:00.000Z");

test("writes to the per-user Windows log only on Windows with LOCALAPPDATA", async () => {
  const writes = [];
  const files = [];
  const createLog = ({ file }) => { files.push(file); return { write: async (event) => { writes.push(event); } }; };
  const logger = createAppLogger({ env: { LOCALAPPDATA: "C:\\Users\\rowan\\AppData\\Local" }, platform: "win32", now: () => TIME, createLog });
  assert.equal(logger.enabled, true);
  assert.equal(await logger.event("startup", "failed", { level: "error", code: "CONFIG_INVALID" }), true);
  assert.deepEqual(files, ["C:\\Users\\rowan\\AppData\\Local\\nowplaying\\logs\\nowplaying.log"]);
  assert.deepEqual(writes, [{ time: TIME, level: "error", component: "startup", status: "failed", code: "CONFIG_INVALID" }]);

  for (const options of [{ platform: "linux", env: { LOCALAPPDATA: "C:\\x" } }, { platform: "win32", env: {} }, { platform: "win32", env: { LOCALAPPDATA: "  " } }]) {
    const off = createAppLogger({ ...options, createLog });
    assert.equal(off.enabled, false);
    assert.equal(await off.event("startup", "starting"), false);
  }
  assert.equal(files.length, 1);
});

test("logging failures never break the app and are counted", async () => {
  const logger = createAppLogger({ env: { LOCALAPPDATA: "C:\\L" }, platform: "win32", createLog: () => ({ write: async () => { throw new Error("disk full at C:\\Users\\rowan"); } }) });
  assert.equal(await logger.event("startup", "starting"), false);
  assert.equal(logger.failures(), 1);
  const broken = createAppLogger({ env: { LOCALAPPDATA: "C:\\L" }, platform: "win32", createLog: () => { throw new Error("nope"); } });
  assert.equal(broken.enabled, false);
});

test("invalid events are rejected by the privacy-safe serializer, not written", async () => {
  const { createRotatingLog } = await import("../src/app-log.js");
  const logger = createAppLogger({ env: { LOCALAPPDATA: "C:\\L" }, platform: "win32", createLog: () => createRotatingLog({ file: "/nonexistent-dir-for-test/should-not-be-created.log" }) });
  assert.equal(await logger.event("startup", "failed", { code: "http://192.168.1.2/token=abc" }), false);
});

test("Windows entry logs startup lifecycle with fixed codes only", async () => {
  const entry = await readFile(new URL("../scripts/windows-entry.js", import.meta.url), "utf8");
  for (const needle of ['"startup", "starting"', '"startup", "ok"', '"startup", "failed"', '"startup", "stopped"', "CONFIG_LOAD_FAILED", "CONFIG_INVALID", "APP_INVALID", "START_FAILED"]) {
    assert.equal(entry.includes(needle), true, needle);
  }
  assert.doesNotMatch(entry, /event\([^)]*(message|configPath|stack)/);
});
