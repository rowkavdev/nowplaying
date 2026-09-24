import test from "node:test";
import assert from "node:assert/strict";

import { hostedUploadPreview, checkHostedEndpoint } from "../src/hosted-preview.js";

const keys = (list) => list.map((f) => f.key);

test("default settings preview every card field", () => {
  const p = hostedUploadPreview({});
  assert.deepEqual(keys(p.sent), ["state", "kind", "title", "subtitle", "durationMs", "positionMs"]);
  assert.deepEqual(p.withheld, []);
  assert.ok(p.neverSent.some((s) => /Artwork/.test(s)));
  assert.equal(p.sample.title, "Sample song");
});

test("card and privacy settings remove fields from the preview", () => {
  const p = hostedUploadPreview({ show: { subtitle: false, progress: false, mediaType: false } });
  assert.deepEqual(keys(p.sent), ["state", "kind", "title"]);
  assert.deepEqual(keys(p.withheld), ["subtitle", "durationMs", "positionMs"]);
  assert.equal(p.sample.kind, "unknown");
  const priv = hostedUploadPreview({ privacy: { hideProgress: true, redactTitles: true, titleReplacement: "Private media" } });
  assert.ok(!keys(priv.sent).includes("positionMs"));
  assert.notEqual(priv.sample.title, "Sample song");
});

test("private mode previews state only", () => {
  const p = hostedUploadPreview({ privacy: { mode: "private" } });
  assert.ok(keys(p.sent).length <= 2);
  assert.ok(!keys(p.sent).includes("title"));
});

function fakeFetch(respond) {
  const calls = [];
  const impl = async (url, init) => { calls.push({ url, init }); return respond(url, init); };
  return { impl, calls };
}

test("endpoint check calls /healthz only, with no credentials", async () => {
  const f = fakeFetch(() => ({ status: 200, text: async () => "ok\n" }));
  assert.deepEqual(await checkHostedEndpoint("https://cards.example.com/", { fetchImpl: f.impl }), { ok: true, url: "https://cards.example.com" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://cards.example.com/healthz");
  assert.equal(f.calls[0].init.method, "GET");
  assert.equal(f.calls[0].init.redirect, "error");
  assert.equal(f.calls[0].init.headers.authorization, undefined);
  assert.equal(f.calls[0].init.body, undefined);
});

test("endpoint check reports bad URLs, wrong services and network failures", async () => {
  assert.equal((await checkHostedEndpoint("http://cards.example.com")).reason, "invalid_url");
  assert.equal((await checkHostedEndpoint("https://u:p@cards.example.com")).reason, "invalid_url");
  assert.equal((await checkHostedEndpoint("https://x.example", { fetchImpl: async () => ({ status: 404, text: async () => "" }) })).reason, "bad_status");
  assert.equal((await checkHostedEndpoint("https://x.example", { fetchImpl: async () => ({ status: 200, text: async () => "<html>" }) })).reason, "not_nowplaying");
  assert.equal((await checkHostedEndpoint("https://x.example", { fetchImpl: async () => { throw new TypeError("fetch failed"); } })).reason, "unreachable");
  const hang = (_u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  assert.equal((await checkHostedEndpoint("https://x.example", { fetchImpl: hang, timeoutMs: 20 })).reason, "timeout");
});
