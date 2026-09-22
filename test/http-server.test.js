import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createHttpServer } from "../src/http-server.js";

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
