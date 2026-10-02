import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedBytes } from "../src/bounded-response.js";

function streamResponse(chunks, headers = {}) {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      const next = chunks.shift();
      if (next) controller.enqueue(next); else controller.close();
    },
    cancel() { cancelled = true; },
  });
  return { response: { body, headers: new Headers(headers) }, wasCancelled: () => cancelled };
}

test("reads a streamed body under the cap", async () => {
  const { response } = streamResponse([new Uint8Array([1, 2]), new Uint8Array([3])]);
  assert.deepEqual(await readBoundedBytes(response, 3), new Uint8Array([1, 2, 3]));
});

test("rejects a declared Content-Length over the cap without reading", async () => {
  const { response } = streamResponse([new Uint8Array(1)], { "content-length": "11" });
  await assert.rejects(readBoundedBytes(response, 10, "update archive"), /update archive is too large/);
});

test("stops reading and cancels a stream that grows past the cap", async () => {
  const { response, wasCancelled } = streamResponse([new Uint8Array(6), new Uint8Array(6), new Uint8Array(6)]);
  await assert.rejects(readBoundedBytes(response, 10), /too large/);
  assert.equal(wasCancelled(), true);
});

test("caps buffered arrayBuffer and text bodies too", async () => {
  const headers = new Headers({ "content-length": "5" });
  await assert.rejects(readBoundedBytes({ headers, arrayBuffer: async () => new ArrayBuffer(11) }, 10), /too large/);
  await assert.rejects(readBoundedBytes({ headers, text: async () => "x".repeat(11) }, 10), /too large/);
  assert.equal((await readBoundedBytes({ headers: new Headers({ "content-length": "2" }), text: async () => "ok" }, 10)).byteLength, 2);
});


test("refuses non-streaming bodies without an acceptable declared length", async () => {
  let arrayBufferCalled = false;
  await assert.rejects(
    readBoundedBytes({ arrayBuffer: async () => { arrayBufferCalled = true; return new Uint8Array(1_048_576).buffer; } }, 1024, "fixture"),
    /fixture is too large/,
  );
  assert.equal(arrayBufferCalled, false);
  let textCalled = false;
  await assert.rejects(
    readBoundedBytes({ text: async () => { textCalled = true; return "x".repeat(1_048_576); } }, 1024, "fixture"),
    /fixture is too large/,
  );
  assert.equal(textCalled, false);
  // An empty or unparsable Content-Length is no declaration at all.
  for (const headers of [new Headers({ "content-length": "" }), new Headers({ "content-length": "soon" })]) {
    await assert.rejects(readBoundedBytes({ headers, text: async () => "ok" }, 1024), /too large/);
  }
});

test("buffers non-streaming bodies that declare a length within the cap", async () => {
  assert.equal((await readBoundedBytes({ headers: new Headers({ "content-length": "2" }), text: async () => "ok" }, 10)).byteLength, 2);
  assert.equal((await readBoundedBytes({ headers: new Headers({ "content-length": "4" }), arrayBuffer: async () => new Uint8Array(4).buffer }, 10)).byteLength, 4);
});

test("an over-declared response body is cancelled, not left open", async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(10)); }, cancel() { cancelled = true; } });
  const response = new Response(body, { headers: { "content-length": "999999" } });
  await assert.rejects(readBoundedBytes(response, 1000, "Artwork"), /too large/);
  assert.equal(cancelled, true);
});
