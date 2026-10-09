import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadVerifiedUpdate } from '../src/update-download.js';
const assetUrl = 'https://api.github.com/repos/fixture/project/releases/assets/1';
const checksumUrl = 'https://api.github.com/repos/fixture/project/releases/assets/2';
const update = { available: true, version: '1.0.0', assetUrl, checksumUrl };
for (const failed of [assetUrl, checksumUrl]) for (const failureMode of ['read error', 'overflow']) for (const cleanup of ['settled', 'pending', 'throwing']) {
  test(`${failed === assetUrl ? 'archive' : 'manifest'} ${failureMode} cancels stalled sibling (${cleanup})`, async () => {
    let cancelled = 0;
    const failure = new Error('fixture read failure');
    const stalled = new ReadableStream({cancel() { cancelled++; if (cleanup === 'pending') return new Promise(() => {}); if (cleanup === 'throwing') throw new Error('cleanup failure'); }});
    const broken = new ReadableStream({start(c) { if (failureMode === 'read error') c.error(failure); }});
    const fetchImpl = async url => ({ok:true,url,body:url === failed ? broken : stalled,headers:new Headers(url === failed && failureMode === 'overflow' ? {'content-length':String(101 * 1024 * 1024)} : {})});
    let timer;
    try {
      await assert.rejects(Promise.race([
        downloadVerifiedUpdate({ update, fetchImpl }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cleanup blocked failure')), 100); }),
      ]), error => failureMode === 'read error' ? error === failure : /too large/.test(error.message));
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(cancelled, 1);
      assert.equal(stalled.locked, false);
      assert.equal(broken.locked, false);
    } finally { clearTimeout(timer); }
  });
}
