import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRotatingLog, serializeLogEvent, windowsLogPath } from "../src/app-log.js";

const TIME = new Date("2026-09-23T00:50:00.000Z");
const event = (code = null) => ({ time: TIME, level: "info", component: "provider", status: "ok", code });

test("resolves a stable per-user Windows log path", () => {
  assert.equal(windowsLogPath({ localAppData: "C:\\Users\\rowan\\AppData\\Local" }), join("C:\\Users\\rowan\\AppData\\Local", "nowplaying", "logs", "nowplaying.log"));
  assert.throws(() => windowsLogPath(), /LOCALAPPDATA is required/);
  assert.throws(() => windowsLogPath({ localAppData: "x", appName: "../other" }), /appName is invalid/);
});

test("serializes only bounded privacy-safe event fields", () => {
  const line = serializeLogEvent({ ...event("PROVIDER_TIMEOUT"), title: "Secret Movie", username: "alice", providerUrl: "https://private.invalid", token: "secret" });
  assert.deepEqual(JSON.parse(line), { time: TIME.toISOString(), level: "info", component: "provider", status: "ok", code: "PROVIDER_TIMEOUT" });
  for (const value of ["Secret Movie", "alice", "private.invalid", "token"]) assert.equal(line.includes(value), false);
});

test("rejects arbitrary or unsafe log text", () => {
  assert.throws(() => serializeLogEvent({ ...event(), code: "token=secret" }), /log code is invalid/);
  assert.throws(() => serializeLogEvent({ ...event(), component: "https://private.invalid" }), /log event is invalid/);
  assert.throws(() => serializeLogEvent({ ...event(), status: "Secret Movie" }), /log event is invalid/);
});

test("writes private logs and appends across logger restarts", async () => {
  const root = await mkdtemp(join(tmpdir(), "nowplaying-log-"));
  const file = join(root, "logs", "nowplaying.log");
  await createRotatingLog({ file, maxBytes: 2048, retain: 2 }).write(event("STARTED"));
  await createRotatingLog({ file, maxBytes: 2048, retain: 2 }).write({ ...event("CONNECTED"), component: "discord" });
  const lines = (await readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map((item) => item.code), ["STARTED", "CONNECTED"]);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("rotates before exceeding size and retains only the configured count", async () => {
  const root = await mkdtemp(join(tmpdir(), "nowplaying-log-"));
  const file = join(root, "nowplaying.log");
  const log = createRotatingLog({ file, maxBytes: 1024, retain: 2 });
  for (let index = 0; index < 40; index += 1) await log.write(event(`EVENT_${index}`));
  const current = await readFile(file, "utf8");
  const first = await readFile(`${file}.1`, "utf8");
  const second = await readFile(`${file}.2`, "utf8");
  for (const value of [current, first, second]) assert.ok(Buffer.byteLength(value) <= 1024);
  await assert.rejects(readFile(`${file}.3`, "utf8"), /ENOENT/);
  assert.match(current, /EVENT_39/);
});

test("validates size and retention bounds", () => {
  assert.throws(() => createRotatingLog({ file: "x", maxBytes: 1023 }), /maxBytes is invalid/);
  assert.throws(() => createRotatingLog({ file: "x", retain: 0 }), /retain is invalid/);
  assert.throws(() => createRotatingLog(), /file is required/);
});
