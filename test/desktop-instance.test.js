import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { DesktopInstanceError, loadDesktopInstanceSecret, withDesktopInstance, findDesktopInstance } from "../src/desktop-instance.js";
import { createHttpServer } from "../src/http-server.js";

test("simultaneous launches share an exclusively created private instance secret", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "np-instance-")), "data", "desktop-instance-secret");
  const secrets = await Promise.all(Array.from({ length: 8 }, () => loadDesktopInstanceSecret(file)));
  assert.match(secrets[0], /^[a-f0-9]{64}$/);
  assert.ok(secrets.every((value) => value === secrets[0]));
  assert.equal((await readFile(file, "utf8")).trim(), secrets[0]);
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("damaged, empty and inaccessible instance identities have an actionable startup error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "np-instance-errors-"));
  const file = join(dir, "desktop-instance-secret");
  for (const contents of ["malformed", ""]) {
    await writeFile(file, contents);
    await assert.rejects(loadDesktopInstanceSecret(file), (error) => error instanceof DesktopInstanceError && error.startupCode === "INSTANCE_IDENTITY_UNAVAILABLE" && /desktop-instance-secret/.test(error.message));
  }
  const directory = join(dir, "directory");
  await mkdir(directory);
  await assert.rejects(loadDesktopInstanceSecret(directory), (error) => error instanceof DesktopInstanceError && /permissions/.test(error.message));
  await assert.rejects(loadDesktopInstanceSecret(join(file, "child")), (error) => error instanceof DesktopInstanceError && /permissions/.test(error.message));
});

test("only the same install verifies; challenges expose neither private nor session secrets", async () => {
  const secret = "a".repeat(64);
  const sessionSecret = "session".repeat(8);
  const server = createHttpServer({ port: 0, sessionSecret, handler: withDesktopInstance(() => ({ status: 404, headers: {}, body: "Not Found" }), secret) });
  const { port } = await server.listen();
  try {
    assert.equal(await findDesktopInstance({ port, secret }), `http://127.0.0.1:${port}`);
    assert.equal(await findDesktopInstance({ port, secret: "b".repeat(64) }), null);
    const response = await fetch(`http://127.0.0.1:${port}/api/desktop-instance?challenge=${"f".repeat(32)}`);
    const body = await response.text();
    assert.equal(body.includes(secret), false);
    assert.equal(body.includes(sessionSecret), false);
    assert.equal(response.headers.has("set-cookie"), false);
    const invalid = await fetch(`http://127.0.0.1:${port}/api/desktop-instance?challenge=bad`);
    assert.equal(invalid.status, 400);
    const hostile = await new Promise((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: `/api/desktop-instance?challenge=${"f".repeat(32)}`, headers: { host: "attacker.example" } }, (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, body }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(hostile.status, 421, "the proof endpoint remains behind the loopback Host check");
    assert.doesNotMatch(hostile.body, /proof/);
    const write = await fetch(`http://127.0.0.1:${port}/api/desktop-instance?challenge=${"f".repeat(32)}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" }, body: "{}" });
    assert.equal(write.status, 403, "adding the endpoint must not weaken existing write/session checks");
  } finally { await server.close(); }
});

test("unrelated listeners cannot redirect the launcher or make it accept an app name alone", async () => {
  const secret = "a".repeat(64);
  const urls = [];
  for (const value of [JSON.stringify({ app: "NowPlaying" }), "a".repeat(2048), "null"]) {
    const found = await findDesktopInstance({ port: 47832, secret, fetchImpl: async (url, options) => {
      urls.push(url);
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(value, { headers: { "content-type": "application/json" } });
    } });
    assert.equal(found, null);
  }
  assert.ok(urls.every((url) => !url.includes(secret)));
});
