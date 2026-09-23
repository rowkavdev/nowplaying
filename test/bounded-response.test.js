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
  await assert.rejects(readBoundedBytes({ arrayBuffer: async () => new ArrayBuffer(11) }, 10), /too large/);
  await assert.rejects(readBoundedBytes({ text: async () => "x".repeat(11) }, 10), /too large/);
  assert.equal((await readBoundedBytes({ text: async () => "ok" }, 10)).byteLength, 2);
});
