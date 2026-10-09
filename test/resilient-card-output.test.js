import test from "node:test";
import assert from "node:assert/strict";
import { createResilientCardResolver } from "../src/resilient-card.js";
import { createCardHandler } from "../src/http-handler.js";

const svg = "<svg>good</svg>";
const malformed = [undefined, null, "not svg", { svg: 17 }, { svg: "not svg" }];

test("malformed output preserves last-good card through handler and later failures", async () => {
  for (const bad of malformed) {
    let mode = "good";
    const resolve = createResilientCardResolver({
      diagnostics: true,
      resolveCard: async () => {
        if (mode === "failed") throw new Error("offline");
        return mode === "good" ? svg : bad;
      },
    });
    const handler = createCardHandler({ resolveCard: resolve });
    assert.equal((await handler({ url: "/card.svg" })).body, svg);
    mode = "malformed";
    const fallback = await handler({ url: "/card.svg" });
    assert.equal(fallback.status, 200);
    assert.equal(fallback.body, svg);
    assert.equal(fallback.headers["X-Nowplaying-Source"], "last-good");
    mode = "failed";
    assert.equal((await handler({ url: "/card.svg" })).body, svg);
  }
});

test("malformed output without last-good rejects and never creates a fallback", async () => {
  for (const bad of malformed) {
    let failing = false;
    const resolve = createResilientCardResolver({ resolveCard: async () => {
      if (failing) throw new Error("offline");
      return bad;
    } });
    await assert.rejects(resolve(), /invalid card output/);
    failing = true;
    await assert.rejects(resolve(), /offline/);
  }
});

test("malformed output cannot refresh the age of the last-good card", async () => {
  let at = 0;
  let good = true;
  const resolve = createResilientCardResolver({ now: () => at, staleMs: 1000, resolveCard: async () => good ? svg : "bad" });
  await resolve();
  good = false;
  at = 900;
  assert.equal(await resolve(), svg);
  at = 1001;
  await assert.rejects(resolve(), /invalid card output/);
});
