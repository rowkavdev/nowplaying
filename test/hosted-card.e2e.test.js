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
