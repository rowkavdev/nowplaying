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
  const f = fakeFetch(() => health("ok\n"));
  assert.deepEqual(await checkHostedEndpoint("https://cards.example.com/", { fetchImpl: f.impl }), { ok: true, url: "https://cards.example.com" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://cards.example.com/healthz");
  assert.equal(f.calls[0].init.method, "GET");
  assert.equal(f.calls[0].init.redirect, "error");
  assert.equal(f.calls[0].init.headers.authorization, undefined);
  assert.equal(f.calls[0].init.body, undefined);
});

// Models a real server's bounded health reply: a declared Content-Length and
// no streaming body, so the fallback adapter path sees a trusted size.
const health = (text) => ({ status: 200, headers: { get: (name) => name === "content-length" ? String(new TextEncoder().encode(text).byteLength) : null }, text: async () => text });

test("endpoint check reports bad URLs, wrong services and network failures", async () => {
  assert.equal((await checkHostedEndpoint("http://cards.example.com")).reason, "invalid_url");
  assert.equal((await checkHostedEndpoint("https://u:p@cards.example.com")).reason, "invalid_url");
  assert.equal((await checkHostedEndpoint("https://x.example", { fetchImpl: async () => ({ status: 404, text: async () => "" }) })).reason, "bad_status");
  assert.equal((await checkHostedEndpoint("https://x.example", { fetchImpl: async () => (health("<html>")) })).reason, "not_nowplaying");
  assert.equal((await checkHostedEndpoint("https://x.example", { fetchImpl: async () => { throw new TypeError("fetch failed"); } })).reason, "unreachable");
  const hang = (_u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  assert.equal((await checkHostedEndpoint("https://x.example", { fetchImpl: hang, timeoutMs: 20 })).reason, "timeout");
});

test("endpoint check rejects an oversized health body instead of buffering it (#751)", async () => {
  let chunksRead = 0, cancelled = false;
  const chunk = new Uint8Array(512);
  const fetchImpl = async () => ({
    status: 200,
    headers: { get: () => null }, // no Content-Length
    body: {
      getReader: () => ({
        read: async () => { chunksRead += 1; return chunksRead > 16 ? { done: true } : { done: false, value: chunk }; },
        cancel: async () => { cancelled = true; },
      }),
    },
    text: async () => { throw new Error("text() must not be used for a streaming body"); },
  });
  assert.equal((await checkHostedEndpoint("https://cards.example.com", { fetchImpl })).reason, "not_nowplaying");
  assert.equal(cancelled, true);
  assert.ok(chunksRead <= 4, `stream should stop at the cap, read ${chunksRead} chunks`);
});

test("endpoint check refuses a no-stream body with no declared size (#751)", async () => {
  let textCalled = false;
  const fetchImpl = async () => ({
    status: 200,
    headers: { get: () => null },
    text: async () => { textCalled = true; return `${" ".repeat(1024 * 1024)}ok`; },
  });
  assert.equal((await checkHostedEndpoint("https://cards.example.com", { fetchImpl })).reason, "not_nowplaying");
  assert.equal(textCalled, false, "text() must not be called without a trusted size");
});

test("endpoint check rejects a declared oversized body without reading it (#751)", async () => {
  let textCalled = false;
  const fetchImpl = async () => ({
    status: 200,
    headers: { get: (name) => name === "content-length" ? String(2 * 1024 * 1024) : null },
    text: async () => { textCalled = true; return "ok"; },
  });
  assert.equal((await checkHostedEndpoint("https://cards.example.com", { fetchImpl })).reason, "not_nowplaying");
  assert.equal(textCalled, false);
});
