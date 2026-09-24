import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseLogLine, readLogTail } from "../src/log-tail.js";
import { createLogsPageHandler } from "../src/logs-page-handler.js";
import { startAppFromConfig } from "../src/app-config.js";
import { serializeLogEvent } from "../src/app-log.js";
import { serializeSetupConfig } from "../src/setup-config.js";

const line = (status, extra = {}) => serializeLogEvent({ time: new Date("2026-09-24T00:00:00Z"), level: "info", component: "startup", status, ...extra });

async function logFile(text) {
  const dir = await mkdtemp(join(tmpdir(), "np-logs-"));
  const file = join(dir, "nowplaying.log");
  await writeFile(file, text);
  return file;
}

test("keeps only the log's own fields and drops anything else", () => {
  assert.deepEqual({ ...parseLogLine(line("ok", { level: "error", code: "PORT_IN_USE" })) }, { time: "2026-09-24T00:00:00.000Z", level: "error", component: "startup", status: "ok", code: "PORT_IN_USE" });
  const extra = JSON.stringify({ time: "2026-09-24T00:00:00Z", level: "info", component: "startup", status: "ok", serverUrl: "http://10.0.0.2:32400" });
  assert.equal(JSON.stringify(parseLogLine(extra)).includes("10.0.0.2"), false);
  for (const bad of ["not json", "[]", "null", JSON.stringify({ time: "x", level: "info", component: "startup", status: "ok" }), JSON.stringify({ time: "2026-09-24T00:00:00Z", level: "debug", component: "startup", status: "ok" }), JSON.stringify({ time: "2026-09-24T00:00:00Z", level: "info", component: "startup", status: "ok", code: "token=abc" })]) {
    assert.equal(parseLogLine(bad), null, bad);
  }
});

test("reads the newest events and skips a cut-off first line", async () => {
  const file = await logFile(Array.from({ length: 50 }, () => line("ok")).join("") + line("stopped"));
  const all = await readLogTail(file, { maxLines: 10 });
  assert.equal(all.length, 10);
  assert.equal(all.at(-1).status, "stopped");
  const part = await readLogTail(file, { maxBytes: 300 });
  assert.ok(part.length >= 1 && part.every((event) => event.component === "startup"));
  assert.deepEqual(await readLogTail(join(file, "..", "missing.log")), []);
  assert.deepEqual(await readLogTail(null), []);
});

test("serves the page and events, GET only, same origin only", async () => {
  const h = createLogsPageHandler({ readEvents: async () => [{ time: "t", level: "info", component: "startup", status: "ok" }], fallback: async () => ({ status: 299 }) });
  const page = await h({ url: "/logs" });
  assert.equal(page.page, true);
  assert.equal(page.body.toLowerCase().split("<script").length, 2);
  assert.equal((await h({ url: "/logs.js" })).status, 200);
  assert.equal((await h({ url: "/logs.css" })).status, 200);
  assert.equal(JSON.parse((await h({ url: "/api/logs" })).body).events.length, 1);
  assert.equal((await h({ method: "HEAD", url: "/api/logs" })).body, "");
  assert.equal((await h({ method: "POST", url: "/api/logs" })).status, 405);
  assert.equal((await h({ url: "/api/logs", headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await h({ url: "/card.svg" })).status, 299);
  const broken = createLogsPageHandler({ readEvents: async () => { throw new Error("EACCES C:\\Users\\rowan"); }, fallback: async () => null });
  const failed = await broken({ url: "/api/logs" });
  assert.deepEqual([failed.status, failed.body], [500, '{"error":"log_unreadable"}']);
  assert.throws(() => createLogsPageHandler({ fallback: async () => null }), TypeError);
  assert.throws(() => createLogsPageHandler({ readEvents: async () => [] }), TypeError);
});

test("the running app shows its log on /logs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-logs-app-"));
  const configFile = join(dir, "config.json");
  await writeFile(configFile, serializeSetupConfig({ provider: "jellyfin", serverUrl: "http://127.0.0.1:8096", identity: { id: "u1", displayName: "Rowan" }, credentialStored: true }));
  const file = await logFile(line("starting") + line("ok"));
  const app = await startAppFromConfig({ configFile, credentialStore: { read: async () => "jf-token" }, port: 0, fetchImpl: async () => Response.json([]), discord: { env: {}, builtInClientId: "" }, logFile: file });
  try {
    assert.equal((await fetch(`${app.url}/logs`)).status, 200);
    assert.deepEqual((await (await fetch(`${app.url}/api/logs`)).json()).events.map((event) => event.status), ["starting", "ok"]);
  } finally {
    await app.close();
  }
});
