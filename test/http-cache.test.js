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


function clock(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test("reports live render time, cache state and provider health", async () => {
  const handler = createCardHandler({ resolveCard: async () => ({ svg, source: "live", ageMs: 1_500, cache: "miss", provider: "ok" }), now: clock(100, 142.4) });
  const response = await handler({ url: "/card.svg" });
  assert.equal(response.headers["X-Nowplaying-Source"], "live");
  assert.equal(response.headers["X-Nowplaying-Age"], "1");
  assert.equal(response.headers["X-Nowplaying-Cache"], "miss");
  assert.equal(response.headers["X-Nowplaying-Provider"], "ok");
  assert.equal(response.headers["X-Nowplaying-Render-Ms"], "42");
  assert.equal(response.headers["Server-Timing"], "render;dur=42");
});

test("stale last-good output names the provider failure class only", async () => {
  const handler = createCardHandler({ resolveCard: async () => ({ svg, source: "last-good", ageMs: 95_000, cache: "hit", provider: "timeout", error: "connect ETIMEDOUT 10.0.0.4:8096", user: "rowan" }), now: clock(0, 3) });
  const first = await handler({ url: "/card.svg" });
  assert.equal(first.headers["X-Nowplaying-Source"], "last-good");
  assert.equal(first.headers["X-Nowplaying-Age"], "95");
  assert.equal(first.headers["X-Nowplaying-Provider"], "timeout");
  assert.doesNotMatch(JSON.stringify(first.headers), /10\.0\.0\.4|ETIMEDOUT|rowan/);
  const conditional = await handler({ url: "/card.svg", headers: { "If-None-Match": first.headers.ETag } });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.headers["X-Nowplaying-Source"], "last-good");
});

test("provider errors without a last-good card are uncached and labelled unavailable", async () => {
  const handler = createCardHandler({ resolveCard: async () => { throw new Error("401 token=abc"); }, now: clock(10, 15) });
  const response = await handler({ url: "/card.svg" });
  assert.equal(response.status, 503);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.headers["X-Nowplaying-Source"], "unavailable");
  assert.equal(response.headers["X-Nowplaying-Render-Ms"], "5");
  assert.doesNotMatch(JSON.stringify(response), /token|401/);
});

test("drops unknown cache and provider values and clamps timing", async () => {
  const handler = createCardHandler({ resolveCard: async () => ({ svg, cache: "http://x", provider: "Bearer abc" }), now: clock(10, 5) });
  const response = await handler({ url: "/card.svg" });
  assert.equal(response.headers["X-Nowplaying-Cache"], undefined);
  assert.equal(response.headers["X-Nowplaying-Provider"], undefined);
  assert.equal(response.headers["X-Nowplaying-Render-Ms"], "0");
  assert.throws(() => createCardHandler({ resolveCard: async () => svg, now: 1 }), TypeError);
});
