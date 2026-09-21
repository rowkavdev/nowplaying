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
