import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSetupApp } from "../src/setup-app.js";
import { createAppStatus } from "../src/app-status.js";
import { createStatusPageHandler } from "../src/status-page-handler.js";
import { createRotatingLog } from "../src/app-log.js";
import { loadAppConfig } from "../src/app-config.js";
import { createPlexProvider } from "../src/providers/plex.js";
import { createJellyfinProvider } from "../src/providers/jellyfin.js";
import { createEmbyProvider } from "../src/providers/emby.js";
import { createNavidromeProvider } from "../src/providers/navidrome.js";

// One end-to-end check for #141's "secrets are stored in the OS credential
// store and absent from config, logs, diagnostics and crash output". Each
// piece has its own tests; this walks a sign-in and a failing server through
// all of them together with the same recognisable secrets.
const PASSWORD = "pw-LEAKCHECK-7f3a";
const TOKEN = "tok-LEAKCHECK-91c2";
const SECRETS = [PASSWORD, TOKEN, "LEAKCHECK"];

function assertClean(label, text) {
  for (const secret of SECRETS) assert.ok(!String(text).includes(secret), `${label} contains a secret`);
}

async function allFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(join(entry.parentPath ?? entry.path, entry.name));
  }
  return out;
}

test("a sign-in puts the secret only in the credential store, never in files setup writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-leak-"));
  const stored = [];
  const credentialStore = { save: async (key, secret) => { stored.push([key, secret]); } };
  const signIn = { signInNavidrome: async ({ password }) => ({ provider: "navidrome", identity: { id: "rowan", displayName: "Rowan" }, secret: `${TOKEN}:${password}` }) };
  const app = await startSetupApp({ draftFile: join(dir, "draft.json"), configFile: join(dir, "config.json"), credentialStore, deviceId: "device-0001", signIn });
  const replies = [];
  try {
    const api = (path, method, body) => fetch(new URL(path, app.url), { method, headers: { "Content-Type": "application/json", "X-Nowplaying-Session": app.sessionSecret }, body: body && JSON.stringify(body) }).then((r) => r.text());
    replies.push(await api("/api/setup/draft", "POST", { action: "next" }));
    replies.push(await api("/api/setup/draft", "POST", { action: "next", changes: { provider: "navidrome" } }));
    replies.push(await api("/api/setup/signin", "POST", { action: "password", provider: "navidrome", baseUrl: "http://127.0.0.1:4533", username: "rowan", password: PASSWORD }));
    replies.push(await api("/api/setup/draft", "GET"));
    for (let i = 0; i < 4; i += 1) replies.push(await api("/api/setup/draft", "POST", { action: "next" }));
  } finally {
    await app.close();
  }
  assert.equal(stored.length, 1, "the secret went to the credential store");
  assert.match(stored[0][1], new RegExp(TOKEN));
  for (const [index, reply] of replies.entries()) assertClean(`setup reply ${index}`, reply);
  const files = await allFiles(dir);
  assert.ok(files.some((file) => file.endsWith("config.json")), "setup wrote the config");
  for (const file of files) assertClean(file, await readFile(file, "utf8"));
});

const PROVIDERS = {
  plex: (fetchImpl) => createPlexProvider({ baseUrl: "http://127.0.0.1:32400", token: TOKEN, fetchImpl }),
  jellyfin: (fetchImpl) => createJellyfinProvider({ baseUrl: "http://127.0.0.1:8096", apiKey: TOKEN, fetchImpl }),
  emby: (fetchImpl) => createEmbyProvider({ baseUrl: "http://127.0.0.1:8096", apiKey: TOKEN, fetchImpl }),
  navidrome: (fetchImpl) => createNavidromeProvider({ baseUrl: "http://127.0.0.1:4533", username: "rowan", token: TOKEN, salt: "s1", fetchImpl }),
};
// A refused connection whose low-level cause carries the full request URL and
// headers (tokens included), and a server that rejects the sign-in.
const FAILURES = {
  refused: async (url, init) => { throw new TypeError("fetch failed", { cause: Object.assign(new Error(`connect ECONNREFUSED ${url} ${JSON.stringify(init?.headers ?? {})}`), { code: "ECONNREFUSED" }) }); },
  rejected: async () => ({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}), text: async () => "" }),
};

test("a failing server never puts a secret into errors, diagnostics, status or the log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-leak-log-"));
  const log = createRotatingLog({ file: join(dir, "nowplaying.log") });
  for (const [name, create] of Object.entries(PROVIDERS)) {
    for (const [kind, fetchImpl] of Object.entries(FAILURES)) {
      const config = { provider: name, serverUrl: "http://127.0.0.1:1", identity: { id: "rowan", displayName: "Rowan" } };
      const status = createAppStatus({ config, version: "0.2.0" });
      const provider = status.wrapProvider(create(fetchImpl));
      const error = await provider.getPresence().then(() => null, (caught) => caught);
      assert.ok(error, `${name} ${kind} should fail`);
      // The secret really was in play: the refused case carries it in its cause.
      if (kind === "refused") assert.ok(String(error.cause?.message).includes(TOKEN), `${name} fake should carry the token`);
      // What the Windows entry prints if this ever reached the top level.
      assertClean(`${name} ${kind} error message`, error.message);
      assertClean(`${name} ${kind} status`, JSON.stringify(status.snapshot()));
      assertClean(`${name} ${kind} diagnostics`, JSON.stringify(status.diagnostics()));
      const page = createStatusPageHandler({ status, fallback: async () => null });
      assertClean(`${name} ${kind} /api/diagnostics`, (await page({ method: "GET", url: "/api/diagnostics" })).body);
      assertClean(`${name} ${kind} /api/status`, (await page({ method: "GET", url: "/api/status" })).body);
      await log.write({ time: new Date(), level: "warn", component: "provider", status: "failed", code: kind === "refused" ? "PROVIDER_UNREACHABLE" : "PROVIDER_UNAUTHORIZED" });
    }
  }
  // The log only takes fixed codes, so free text (a secret) can't be written.
  await assert.rejects(log.write({ time: new Date(), level: "warn", component: "provider", status: "failed", code: TOKEN }));
  const logText = await readFile(join(dir, "nowplaying.log"), "utf8");
  assert.equal(logText.trim().split("\n").length, 8, "every failure was logged");
  assertClean("log file", logText);
});

test("a config with a pasted secret fails to load without echoing it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-leak-config-"));
  const file = join(dir, "config.json");
  await writeFile(file, JSON.stringify({ version: 2, servers: [], discord: { enabled: true }, token: TOKEN }));
  const error = await loadAppConfig(file).then(() => null, (caught) => caught);
  assert.ok(error, "the config is refused");
  assertClean("startup error", `${error.message} ${error.code ?? ""}`);
});
