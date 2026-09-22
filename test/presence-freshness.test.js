import test from "node:test";
import assert from "node:assert/strict";
import { presenceAgeMs, presenceFreshness } from "../src/presence-freshness.js";

const now = Date.parse("2026-09-22T05:00:00.000Z");

test("reports a fresh presence inside the timeout", () => {
  assert.deepEqual(presenceFreshness({ updatedAt: "2026-09-22T04:59:30.000Z" }, { now, staleAfterMs: 60_000 }), {
    ageMs: 30_000,
    staleAfterMs: 60_000,
    fresh: true,
  });
});

test("reports a stale presence beyond the timeout", () => {
  assert.equal(presenceFreshness({ updatedAt: "2026-09-22T04:58:59.999Z" }, { now }).fresh, false);
});

test("clamps future observations to zero age", () => {
  assert.equal(presenceAgeMs({ updatedAt: "2026-09-22T05:00:01.000Z" }, now), 0);
});

test("rejects invalid timestamps and unsafe timeout bounds", () => {
  assert.throws(() => presenceAgeMs({ updatedAt: "not-a-date" }, now), /valid date/);
  assert.throws(() => presenceFreshness({ updatedAt: new Date(now) }, { now, staleAfterMs: 999 }), /staleAfterMs/);
  assert.throws(() => presenceFreshness({ updatedAt: new Date(now) }, { now, staleAfterMs: 3_600_001 }), /staleAfterMs/);
});
