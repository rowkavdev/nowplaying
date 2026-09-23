import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createHttpServer, PAGE_CSP } from "../src/http-server.js";

const SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

function get(port, path = "/card.svg", authority = null) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, ...(authority ? { headers: { Host: authority } } : {}) }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.once("error", reject).end();
  });
}

function assertSecurityHeaders(headers) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(headers[name], value, name);
}

test("accepts only explicit loopback hosts", () => {
  const handler = async () => ({ status: 204, headers: {}, body: "" });
  for (const host of ["localhost", "127.0.0.1", "127.0.0.2", "::1", "0:0:0:0:0:0:0:1"]) {
    assert.doesNotThrow(() => createHttpServer({ handler, host }), host);
  }
  for (const host of ["0.0.0.0", "192.0.2.1", "2001:db8::1", "example.com", "localhost.example.com", ""]) {
    assert.throws(() => createHttpServer({ handler, host }), /loopback/, host);
  }
});

test("adapts handler responses onto a real Node HTTP server with invariant security headers", async () => {
  const app = createHttpServer({
    port: 0,
    handler: async ({ url }) => ({
      status: 200,
      headers: { "Content-Type": "text/plain", "Cache-Control": "public", "X-Frame-Options": "SAMEORIGIN" },
      body: url,
    }),
  });
  const address = await app.listen();
  try {
    const result = await get(address.port, "/healthz");
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-type"], "text/plain");
    assert.equal(result.body, "/healthz");
    assertSecurityHeaders(result.headers);
  } finally { await app.close(); }
});

test("sanitizes unexpected adapter failures and preserves security headers", async () => {
  const app = createHttpServer({ port: 0, handler: async () => { throw new Error("token=secret"); } });
  const address = await app.listen();
  try {
    const result = await get(address.port);
    assert.equal(result.status, 500);
    assert.equal(result.body, "Internal Server Error");
    assert.equal(result.headers["content-type"], "text/plain; charset=utf-8");
    assertSecurityHeaders(result.headers);
  } finally { await app.close(); }
});

test("accepts loopback request authorities with optional ports", async () => {
  let calls = 0;
  const app = createHttpServer({ port: 0, handler: async () => { calls += 1; return { status: 204, headers: {}, body: "" }; } });
  const address = await app.listen();
  try {
    for (const authority of ["localhost", `localhost:${address.port}`, "127.0.0.1", `127.0.0.2:${address.port}`, "[::1]", `[::1]:${address.port}`, "[0:0:0:0:0:0:0:1]"]) {
      const result = await get(address.port, "/healthz", authority);
      assert.equal(result.status, 204, authority);
    }
    assert.equal(calls, 7);
  } finally { await app.close(); }
});

test("rejects hostile and malformed request authorities before the handler", async () => {
  let calls = 0;
  const app = createHttpServer({ port: 0, handler: async () => { calls += 1; return { status: 200, headers: {}, body: "private" }; } });
  const address = await app.listen();
  try {
    for (const authority of ["example.com", "localhost.example.com", "0.0.0.0", "192.0.2.1", "[2001:db8::1]", "user@localhost", "localhost/path", "localhost:99999"]) {
      const result = await get(address.port, "/private", authority);
      assert.equal(result.status, 421, authority);
      assert.equal(result.body, "Misdirected Request", authority);
      assertSecurityHeaders(result.headers);
    }
    assert.equal(calls, 0);
  } finally { await app.close(); }
});


function send(port, { method = "POST", path = "/api/setup/draft", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.once("error", reject);
    req.end(body);
  });
}

async function withServer(options, run) {
  const seen = [];
  const app = createHttpServer({ port: 0, handler: async (req) => { seen.push(req); return { status: 200, headers: { "Content-Type": "application/json" }, body: "{}" }; }, ...options });
  const { port } = await app.listen();
  try { await run(port, seen); } finally { await app.close(); }
}

test("passes same-origin JSON bodies to the handler", async () => {
  await withServer({}, async (port, seen) => {
    const result = await send(port, { headers: { "Content-Type": "application/json; charset=utf-8", Origin: `http://127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin" }, body: '{"step":"provider"}' });
    assert.equal(result.status, 200);
    assertSecurityHeaders(result.headers);
    assert.equal(seen[0].body, '{"step":"provider"}');
    const noOrigin = await send(port, { headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noOrigin.status, 200);
  });
});

test("rejects cross-site, foreign-origin and non-JSON writes before reading the body", async () => {
  await withServer({}, async (port, seen) => {
    for (const headers of [
      { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
      { "Content-Type": "application/json", "Sec-Fetch-Site": "same-site" },
      { "Content-Type": "application/json", Origin: "https://evil.example" },
      { "Content-Type": "application/json", Origin: `http://localhost:${port + 1}` },
      { "Content-Type": "application/json", Origin: "null" },
    ]) {
      const result = await send(port, { headers, body: "{}" });
      assert.equal(result.status, 403, JSON.stringify(headers));
      assertSecurityHeaders(result.headers);
    }
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
      const result = await send(port, { headers: type ? { "Content-Type": type } : {}, body: "a=1" });
      assert.equal(result.status, 415, type);
    }
    assert.equal(seen.length, 0);
  });
});

test("caps request bodies by declared and streamed size", async () => {
  await withServer({ maxBodyBytes: 32 }, async (port, seen) => {
    const declared = await send(port, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pad: "x".repeat(100) }) });
    assert.equal(declared.status, 413);
    const streamed = await new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/", method: "POST", headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.once("error", reject);
      req.write("x".repeat(20)); req.write("x".repeat(20)); req.end();
    });
    assert.equal(streamed, 413);
    assert.equal(seen.length, 0);
  });
  assert.throws(() => createHttpServer({ handler: async () => ({}), maxBodyBytes: 0 }), /maxBodyBytes/);
});

test("GET requests carry no body and keep working without JSON headers", async () => {
  await withServer({}, async (port, seen) => {
    const result = await get(port, "/healthz");
    assert.equal(result.status, 200);
    assert.equal("body" in seen[0], false);
  });
});


test("returns a plain 404 when no handler claims the path", async () => {
  const app = createHttpServer({ port: 0, handler: async () => null });
  const address = await app.listen();
  try {
    const result = await get(address.port, "/nope");
    assert.equal(result.status, 404);
    assert.equal(result.body, "Not Found");
    assertSecurityHeaders(result.headers);
  } finally { await app.close(); }
});

test("uses the page policy only for opted-in HTML pages", async () => {
  const pages = {
    "/setup": { status: 200, page: true, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "script-src *" }, body: "<!doctype html>" },
    "/fake": { status: 200, page: true, headers: { "Content-Type": "application/json" }, body: "{}" },
    "/err": { status: 500, page: true, headers: { "Content-Type": "text/html" }, body: "x" },
    "/plain": { status: 200, headers: { "Content-Type": "text/html" }, body: "x" },
  };
  const app = createHttpServer({ port: 0, handler: async ({ url }) => pages[url] });
  const address = await app.listen();
  try {
    const setup = await get(address.port, "/setup");
    assert.equal(setup.headers["content-security-policy"], PAGE_CSP);
    assert.doesNotMatch(PAGE_CSP, /unsafe|\*|https?:/);
    assert.match(PAGE_CSP, /frame-ancestors 'none'/);
    assert.equal(setup.headers["x-frame-options"], "DENY");
    for (const path of ["/fake", "/err", "/plain"]) {
      assert.equal((await get(address.port, path)).headers["content-security-policy"], SECURITY_HEADERS["content-security-policy"], path);
    }
  } finally { await app.close(); }
});

test("the local app defaults to a rarely used port, overridable with NOWPLAYING_PORT", async () => {
  const { DEFAULT_APP_PORT, resolveAppPort } = await import("../src/app-config.js");
  assert.equal(DEFAULT_APP_PORT, 47832);
  assert.equal(resolveAppPort({}), 47832);
  assert.equal(resolveAppPort({ NOWPLAYING_PORT: "52001" }), 52001);
  for (const bad of ["80", "70000", "abc", "3000.5"]) assert.throws(() => resolveAppPort({ NOWPLAYING_PORT: bad }), /NOWPLAYING_PORT/);
});

test("the app serves a small home page at / instead of Not Found", async () => {
  const { createCardHandler } = await import("../src/http-handler.js");
  const handle = createCardHandler({ resolveCard: async () => "<svg/>" });
  const home = await handle({ method: "GET", url: "/" });
  assert.equal(home.status, 200);
  assert.equal(home.page, true);
  assert.match(home.body, /NowPlaying is running/);
  assert.match(home.body, /href="\/card\.svg"/);
});

test("refuses websocket upgrades", async () => {
  const { request } = await import("node:http");
  const app = createHttpServer({ port: 0, handler: async () => ({ status: 200, headers: {}, body: "ok" }) });
  const { port } = await app.listen();
  try {
    const outcome = await new Promise((resolve) => {
      const req = request({ host: "127.0.0.1", port, path: "/", headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" } });
      req.on("upgrade", () => resolve("upgraded"));
      req.on("response", (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", () => resolve("closed"));
      req.end();
    });
    assert.notEqual(outcome, "upgraded");
  } finally { await app.close(); }
});
