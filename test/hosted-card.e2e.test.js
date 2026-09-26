import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createPresence } from "../src/presence.js";
import { createCardPipeline } from "../src/card-pipeline.js";
import { createResilientCardResolver } from "../src/resilient-card.js";
import { createCardHandler } from "../src/http-handler.js";
import { createHttpServer } from "../src/http-server.js";

function get(port, path) { return new Promise((resolve, reject) => { const req = request({ host: "127.0.0.1", port, path }, (res) => { const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); }); req.once("error", reject).end(); }); }

test("serves a privacy-filtered provider fixture end to end", async () => {
  const provider = { getPresence: async () => createPresence({ state: "playing", kind: "movie", title: "Arrival", subtitle: "2016 · Denis Villeneuve", positionMs: 60000, durationMs: 120000 }) };
  const pipeline = createCardPipeline({ provider, privacy: { redactTitles: true, titleReplacement: "Private media" } });
  const handler = createCardHandler({ resolveCard: createResilientCardResolver({ resolveCard: pipeline }) });
  const app = createHttpServer({ port: 0, handler });
  const address = await app.listen();
  try {
    const result = await get(address.port, "/card.svg?theme=paper&width=320&show=state,progress");
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-type"], "image/svg+xml; charset=utf-8");
    assert.match(result.body, /Private media/);
    assert.doesNotMatch(result.body, /Arrival|Denis Villeneuve/);
  } finally { await app.close(); }
});

test("local last-good card expires after five elapsed minutes despite wall-clock rollback", async () => {
  let wall = 1_800_000_000_000;
  let elapsed = 0;
  let fail = false;
  const provider = { getPresence: async () => {
    if (fail) throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" });
    return createPresence({ state: "playing", kind: "track", title: "Old Secret Track", subtitle: "Old Artist" });
  } };
  const pipeline = createCardPipeline({ provider });
  const handler = createCardHandler({ resolveCard: createResilientCardResolver({ resolveCard: pipeline, diagnostics: true, staleMs: 300_000, now: () => elapsed }) });
  const app = createHttpServer({ port: 0, handler });
  const address = await app.listen();
  try {
    const live = await get(address.port, "/card.svg");
    assert.equal(live.status, 200);
    assert.equal(live.headers["x-nowplaying-source"], "live");
    assert.match(live.body, /Old Secret Track/);
    fail = true;
    wall -= 60 * 60_000;
    wall += 60_000; elapsed += 60_000;
    const recent = await get(address.port, "/card.svg");
    assert.equal(recent.status, 200);
    assert.equal(recent.headers["x-nowplaying-source"], "last-good");
    assert.equal(recent.headers["x-nowplaying-age"], "60");
    wall += 9 * 60_000; elapsed += 9 * 60_000;
    const stale = await get(address.port, "/card.svg");
    assert.equal(stale.status, 503);
    assert.equal(stale.headers["cache-control"], "no-store");
    assert.doesNotMatch(stale.body, /Old Secret Track|Old Artist/);
    assert.equal(wall < 1_800_000_000_000, true);
  } finally { await app.close(); }
});
