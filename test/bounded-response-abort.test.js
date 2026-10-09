import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedBytes } from '../src/bounded-response.js';
for (const timing of ['before', 'during']) for (const mode of ['settled', 'pending', 'throwing']) {
  test(`bounded stream abort ${timing} reading releases lock with ${mode} cancel`, async () => {
    const controller = new AbortController(); const reason = new Error('fixture abort'); let cancelled = 0;
    const body = new ReadableStream({cancel() {cancelled++; if (mode === 'pending') return new Promise(() => {}); if (mode === 'throwing') throw new Error('cleanup failed');}});
    if (timing === 'before') controller.abort(reason);
    const reading = readBoundedBytes(new Response(body), 1024, 'fixture', {signal:controller.signal});
    if (timing === 'during') controller.abort(reason);
    await assert.rejects(reading, error => error === reason);
    assert.equal(cancelled, 1); assert.equal(body.locked, false);
  });
}
test('abort after completed read does not cancel completed body', async () => {
 const controller=new AbortController();let cancelled=0;
 const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([7]));c.close();},cancel(){cancelled++;}});
 assert.deepEqual(await readBoundedBytes(new Response(body),1,'fixture',{signal:controller.signal}),new Uint8Array([7]));
 controller.abort(new Error('late'));assert.equal(cancelled,0);assert.equal(body.locked,false);
});
