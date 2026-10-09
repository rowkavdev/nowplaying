import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadVerifiedUpdate } from '../src/update-download.js';
const assetUrl = 'https://api.github.com/repos/fixture/project/releases/assets/1';
const checksumUrl = 'https://api.github.com/repos/fixture/project/releases/assets/2';
const update = { available: true, version: '1.0.0', assetUrl, checksumUrl };
for (const failed of [assetUrl, checksumUrl]) for (const timing of ['early', 'late']) for (const mode of ['settled', 'pending', 'throwing']) {
  test(`${failed === assetUrl ? 'asset' : 'manifest'} fetch failure cancels ${timing} sibling with ${mode} cleanup`, async () => {
    const failure = new Error('fixture fetch failure');
    let cancelled = 0, pulls = 0, resolveSibling;
    const body = new ReadableStream({
      pull() { pulls++; },
      cancel() { cancelled++; if (mode === 'pending') return new Promise(() => {}); if (mode === 'throwing') throw new Error('cleanup failure'); },
    }, { highWaterMark: 0 });
    const response = new Response(body);
    const sibling = new Promise(resolve => { resolveSibling = resolve; });
    if (timing === 'early') resolveSibling(response);
    let timer;
    try {
      const action = downloadVerifiedUpdate({ update, fetchImpl: url => url === failed ? timing === 'early' ? new Promise((_, reject) => setTimeout(() => reject(failure), 0)) : Promise.reject(failure) : sibling });
      await assert.rejects(Promise.race([action, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('failure blocked')), 100); })]), error => error === failure);
      if (timing === 'late') { resolveSibling(response); await new Promise(resolve => setTimeout(resolve, 0)); }
      assert.equal(cancelled, 1);
      assert.equal(pulls, 0);
      assert.equal(body.locked, false);
    } finally { clearTimeout(timer); }
  });
}
