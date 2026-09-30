import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicBrainzLookup } from '../src/musicbrainz-lookup.js';
function streamed() {
  let chunks = 0, cancelled = false;
  const response = new Response(new ReadableStream({ pull(c) { if (chunks++ === 300) { c.close(); return; } c.enqueue(new Uint8Array(65536).fill(32)); }, cancel() { cancelled = true; } }));
  return { response, checked() { assert.equal(cancelled, true); assert.ok(chunks <= 18, chunks); } };
}
test('776 bounded chunked response rejects and cancels', async () => {
  const fixture = streamed();
  await assert.rejects(createMusicBrainzLookup({ minIntervalMs: 0, fetchImpl: async () => fixture.response })({ title: 'fixture', artist: 'fixture' }));
  fixture.checked();
});
