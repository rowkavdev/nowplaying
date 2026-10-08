import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedBytes } from "../src/bounded-response.js";

for (const scenario of ["success", "overflow", "read error", "pending cancellation"]) {
  test(`bounded body reader releases its stream lock after ${scenario}`, async () => {
    const failure = new Error("fixture read failure");
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        if (scenario === "read error") controller.error(failure);
        else { controller.enqueue(new Uint8Array([1, 2])); if (scenario !== "pending cancellation") controller.close(); }
      },
      cancel() { cancelled = true; if (scenario === "pending cancellation") return new Promise(() => {}); },
    });
    const response = new Response(body);
    if (scenario === "success") assert.deepEqual(await readBoundedBytes(response, 2), new Uint8Array([1, 2]));
    else if (scenario === "read error") await assert.rejects(readBoundedBytes(response, 2), error => error === failure);
    else await assert.rejects(readBoundedBytes(response, 1), /too large/);
    if (scenario === "pending cancellation") assert.equal(cancelled, true);
    assert.equal(body.locked, false);
    const reader = body.getReader();
    reader.releaseLock();
  });
}
