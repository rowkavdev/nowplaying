import test from 'node:test';
import assert from 'node:assert/strict';
import { createJellyfinProvider } from '../src/providers/jellyfin.js';
function streamed() {
  let chunks = 0, cancelled = false;
  const response = new Response(new ReadableStream({ pull(c) { if (chunks++ === 300) { c.close(); return; } c.enqueue(new Uint8Array(65536).fill(32)); }, cancel() { cancelled = true; } }));
  return { response, checked() { assert.equal(cancelled, true); assert.ok(chunks <= 18, chunks); } };
}
test('777 bounded chunked response rejects and cancels', async () => {
  const fixture = streamed();
  await assert.rejects(createJellyfinProvider({ baseUrl: 'http://127.0.0.1:8096', apiKey: 'fixture', fetchImpl: async () => fixture.response }).getPresence());
  fixture.checked();
});
