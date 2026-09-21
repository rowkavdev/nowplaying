import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createHttpServer } from "../src/http-server.js";

function get(port, path = "/card.svg") {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.once("error", reject).end();
  });
}

test("adapts handler responses onto a real Node HTTP server", async () => {
  const app = createHttpServer({ port: 0, handler: async ({ url }) => ({ status: 200, headers: { "Content-Type": "text/plain" }, body: url }) });
  const address = await app.listen();
  try { assert.deepEqual(await get(address.port, "/healthz"), { status: 200, headers: { "content-type": "text/plain", date: assert.any(String), connection: "keep-alive", "keep-alive": "timeout=5", "transfer-encoding": "chunked" }, body: "/healthz" }); }
  finally { await app.close(); }
});

test("sanitizes unexpected adapter failures", async () => {
  const app = createHttpServer({ port: 0, handler: async () => { throw new Error("token=secret"); } });
  const address = await app.listen();
  try { const result = await get(address.port); assert.equal(result.status, 500); assert.equal(result.body, "Internal Server Error"); assert.equal(result.headers["cache-control"], "no-store"); }
  finally { await app.close(); }
});
