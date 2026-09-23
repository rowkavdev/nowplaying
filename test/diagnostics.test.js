import test from "node:test";
import assert from "node:assert/strict";
import { createDiagnosticRecord, redactDiagnosticText } from "../src/diagnostics.js";

const PRIVATE_VALUES = ["alice", "Inception", "My Secret Server"];

for (const [name, input, forbidden] of [
  ["bearer credential", "Authorization: Bearer eyJhbGci.secret", "eyJhbGci"],
  ["basic credential", "basic dXNlcjpwYXNz", "dXNlcj"],
  ["token", "token=super-secret-token", "super-secret-token"],
  ["API key", "api_key: abc123", "abc123"],
  ["webhook secret", "webhook=https://discord.test/hooks/private", "discord.test"],
  ["private URL", "provider failed at https://media.lan:32400/status?id=7", "media.lan"],
  ["IPv4 address", "connect ECONNREFUSED 192.168.1.12:8096", "192.168.1.12"],
  ["IPv6 address", "connect ECONNREFUSED fd00::1234", "fd00::1234"],
  ["Windows username", "C:\\Users\\alice\\AppData\\nowplaying", "alice"],
  ["POSIX username", "/home/alice/.config/nowplaying", "alice"],
  ["known media title", "failed while playing Inception", "Inception"],
]) {
  test(`redacts ${name}`, () => {
    const output = redactDiagnosticText(input, { sensitiveValues: PRIVATE_VALUES });
    assert.doesNotMatch(output, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    assert.match(output, /\[redacted\]/);
  });
}

test("uses longest literal redaction first and preserves harmless context", () => {
  const output = redactDiagnosticText("My Secret Server failed for alice", { sensitiveValues: ["Secret", "My Secret Server", "alice"] });
  assert.equal(output, "[redacted] failed for [redacted]");
});

test("diagnostic records expose only the documented allow-list", () => {
  const record = createDiagnosticRecord({
    version: "0.2.0-beta.4",
    platform: "win32-x64",
    packageType: "portable",
    enabledOutputs: ["discord", "card"],
    provider: { type: "plex", status: "offline", url: "https://secret.lan", token: "secret" },
    health: "degraded",
    updater: "idle",
    tray: "running",
    errors: ["provider alice at 10.0.0.5 failed on Inception"],
    sensitiveValues: ["alice", "Inception"],
    configuration: { token: "must-not-leak" },
  });
  assert.deepEqual(Object.keys(record), ["schemaVersion", "version", "platform", "packageType", "enabledOutputs", "provider", "health", "updater", "tray", "errors", "build"]);
  assert.deepEqual(record.provider, { type: "plex", status: "offline" });
  const serialized = JSON.stringify(record);
  for (const value of ["secret.lan", "must-not-leak", "alice", "10.0.0.5", "Inception"]) assert.doesNotMatch(serialized, new RegExp(value.replaceAll(".", "\\."), "i"));
});

test("rejects unsafe structured labels instead of copying free-form data", () => {
  const record = createDiagnosticRecord({ version: "https://private.example/v1", platform: "win32\ntoken=secret", provider: { type: "plex/key" }, enabledOutputs: ["discord", "https://private"] });
  assert.equal(record.version, null);
  assert.equal(record.platform, null);
  assert.equal(record.provider.type, null);
  assert.deepEqual(record.enabledOutputs, ["discord"]);
});

test("requires sensitiveValues to be an array", () => {
  assert.throws(() => redactDiagnosticText("error", { sensitiveValues: "secret" }), /expected an array/);
});
