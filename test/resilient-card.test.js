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


test("keeps renders and last-good output separate per card variant", async () => {
  let fail = false;
  const resolve = createResilientCardResolver({ resolveCard: async (options) => { if (fail) throw new Error("offline"); return `<svg>${options.theme}</svg>`; } });
  const [paper, compact] = await Promise.all([resolve({ theme: "paper" }), resolve({ theme: "compact" })]);
  assert.equal(paper, "<svg>paper</svg>");
  assert.equal(compact, "<svg>compact</svg>");
  fail = true;
  assert.equal(await resolve({ theme: "compact" }), "<svg>compact</svg>");
  await assert.rejects(resolve({ theme: "midnight-blue" }), /offline/);
});

test("reports privacy-safe diagnostics for live and last-good output", async () => {
  let t = 1_000;
  let failure = null;
  const resolve = createResilientCardResolver({ resolveCard: async () => { if (failure) throw failure; return "<svg>good</svg>"; }, diagnostics: true, staleMs: 60_000, now: () => t });
  assert.deepEqual(await resolve(), { svg: "<svg>good</svg>", source: "live", ageMs: 0, cache: "miss", provider: "ok" });
  t = 16_000;
  failure = Object.assign(new Error("connect ECONNREFUSED 10.0.0.4:8096"), { code: "ECONNREFUSED" });
  const stale = await resolve();
  assert.deepEqual(stale, { svg: "<svg>good</svg>", source: "last-good", ageMs: 15_000, cache: "hit", provider: "unreachable" });
  assert.doesNotMatch(JSON.stringify(stale), /10\.0\.0\.4|ECONNREFUSED/);
  t = 90_000;
  await assert.rejects(resolve(), /ECONNREFUSED/);
});

test("classifies timeouts, auth failures and idle output", async () => {
  let mode = "idle";
  const resolve = createResilientCardResolver({
    resolveCard: async () => {
      if (mode === "idle") return { svg: "<svg>idle</svg>", source: "idle" };
      if (mode === "auth") throw Object.assign(new Error("401"), { status: 401 });
      return new Promise(() => {});
    },
    diagnostics: true,
    timeoutMs: 10,
  });
  assert.equal((await resolve()).source, "idle");
  mode = "auth";
  assert.equal((await resolve()).provider, "unauthorized");
  mode = "hang";
  assert.equal((await resolve()).provider, "timeout");
  assert.throws(() => createResilientCardResolver({ resolveCard: async () => "", diagnostics: "yes" }), TypeError);
});
