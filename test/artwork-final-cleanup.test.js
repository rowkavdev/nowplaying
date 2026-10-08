import test from "node:test";
import assert from "node:assert/strict";
import { fetchArtwork } from "../src/artwork-fetch.js";

const request = { url: "https://fixture.invalid/image", headers: {} };
for (const [name, status, headers, pattern] of [
  ["not found", 404, {}, null],
  ["HTTP error", 500, {}, /Artwork request failed/],
  ["disallowed type", 200, { "content-type": "text/html" }, /not allowed/],
  ["declared overflow", 200, { "content-type": "image/png", "content-length": "1000001" }, /maximum byte size/],
]) {
  test(`artwork cancels the unread final body after ${name}`, async () => {
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
    const response = new Response(body, { status, headers });
    const outcome = fetchArtwork(request, { fetchImpl: async () => response });
    if (pattern) await assert.rejects(outcome, pattern);
    else assert.equal(await outcome, null);
    assert.equal(cancelled, true);
  });
}
for (const mode of ["throws", "rejects", "pending"]) {
  test(`final body cancellation that ${mode} cannot replace or delay the artwork error`, async () => {
    let cancelled = false;
    const response = { status: 500, ok: false, statusText: "Error", body: { cancel() {
      cancelled = true;
      if (mode === "throws") throw new Error("cancel failed");
      if (mode === "rejects") return Promise.reject(new Error("cancel failed"));
      return new Promise(() => {});
    } } };
    const outcome = await Promise.race([
      fetchArtwork(request, { fetchImpl: async () => response }).then(() => "resolved", error => error.message),
      new Promise(resolve => setTimeout(() => resolve("hung"), 50)),
    ]);
    assert.match(outcome, /Artwork request failed/);
    assert.equal(cancelled, true);
  });
}
