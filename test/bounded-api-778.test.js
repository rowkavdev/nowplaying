import test from 'node:test';
import assert from 'node:assert/strict';
import { signInEmby } from '../src/provider-signin.js';
function streamed() {
  let chunks = 0, cancelled = false;
  const response = new Response(new ReadableStream({ pull(c) { if (chunks++ === 300) { c.close(); return; } c.enqueue(new Uint8Array(65536).fill(32)); }, cancel() { cancelled = true; } }));
  return { response, checked() { assert.equal(cancelled, true); assert.ok(chunks <= 18, chunks); } };
}
test('778 bounded chunked response rejects and cancels', async () => {
  const fixture = streamed();
  await assert.rejects(signInEmby({ baseUrl: 'http://127.0.0.1:8096', username: 'fixture', password: 'fixture', deviceId: 'fixture', fetchImpl: async () => fixture.response }), { status: 'connection_failed' });
  fixture.checked();
});

test('JSON-only adapters are refused without invoking their unbounded parser', async () => {
  let called = false;
  await assert.rejects(signInEmby({ baseUrl: 'http://127.0.0.1:8096', username: 'fixture', password: 'fixture', deviceId: 'fixture', fetchImpl: async () => ({ ok: true, status: 200, json: async () => { called = true; return {}; } }) }), { status: 'connection_failed' });
  assert.equal(called, false);
});
