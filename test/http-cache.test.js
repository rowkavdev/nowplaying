import test from "node:test";
import assert from "node:assert/strict";
import { createCardHandler } from "../src/http-handler.js";

const svg = "<svg><title>playing</title></svg>";

test("emits stable ETags and honors conditional GET", async () => {
  const handler = createCardHandler({ resolveCard: async () => svg });
  const first = await handler({ url: "/card.svg" });
  assert.match(first.headers.ETag, /^"[A-Za-z0-9_-]{43}"$/);
  assert.equal(first.headers["Cache-Control"], "public, max-age=30, stale-while-revalidate=60");
  const cached = await handler({ url: "/card.svg", headers: { "If-None-Match": first.headers.ETag } });
  assert.equal(cached.status, 304);
  assert.equal(cached.body, "");
  assert.equal(cached.headers.ETag, first.headers.ETag);
});

test("supports Headers-compatible request headers and never caches failures", async () => {
  const handler = createCardHandler({ resolveCard: async () => svg });
  const first = await handler({ url: "/card.svg" });
  const cached = await handler({ url: "/card.svg", headers: new Headers({ "If-None-Match": first.headers.ETag }) });
  assert.equal(cached.status, 304);
  const failed = await createCardHandler({ resolveCard: async () => { throw new Error("secret"); } })({ url: "/card.svg" });
  assert.equal(failed.headers["Cache-Control"], "no-store");
});


test("emits bounded privacy-safe cache diagnostics", async () => {
  const handler = createCardHandler({ resolveCard: async () => ({ svg, source: "last-good", ageMs: 12_999, title: "private title", providerUrl: "http://192.168.1.2" }) });
  const response = await handler({ url: "/card.svg" });
  assert.equal(response.headers["X-Nowplaying-Source"], "last-good");
  assert.equal(response.headers["X-Nowplaying-Age"], "12");
  assert.equal(JSON.stringify(response.headers).includes("private title"), false);
  assert.equal(JSON.stringify(response.headers).includes("192.168.1.2"), false);
});

test("omits invalid cache diagnostic values", async () => {
  const handler = createCardHandler({ resolveCard: async () => ({ svg, source: "provider-error", ageMs: Number.NaN }) });
  const response = await handler({ url: "/card.svg" });
  assert.equal(response.headers["X-Nowplaying-Source"], undefined);
  assert.equal(response.headers["X-Nowplaying-Age"], undefined);
});
