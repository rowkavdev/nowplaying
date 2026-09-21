import test from "node:test";
import assert from "node:assert/strict";
import { createResilientCardResolver } from "../src/resilient-card.js";

test("deduplicates concurrent renders", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const resolve = createResilientCardResolver({ resolveCard: async () => { calls += 1; await gate; return "<svg/>"; } });
  const first = resolve({ width: 320 });
  const second = resolve({ width: 320 });
  release();
  assert.deepEqual(await Promise.all([first, second]), ["<svg/>", "<svg/>"]);
  assert.equal(calls, 1);
});

test("times out and serves bounded last-good output", async () => {
  let fail = false;
  const resolve = createResilientCardResolver({ resolveCard: async () => fail ? new Promise(() => {}) : "<svg>good</svg>", timeoutMs: 10, staleMs: 1000 });
  assert.equal(await resolve(), "<svg>good</svg>");
  fail = true;
  assert.equal(await resolve(), "<svg>good</svg>");
});

test("throws when there is no last-good output", async () => {
  const resolve = createResilientCardResolver({ resolveCard: async () => { throw new Error("offline"); }, timeoutMs: 10 });
  await assert.rejects(resolve(), /offline/);
});
