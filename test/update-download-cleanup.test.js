import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadVerifiedUpdate } from '../src/update-download.js';

const assetUrl = 'https://api.github.com/repos/fixture/project/releases/assets/1';
const checksumUrl = 'https://api.github.com/repos/fixture/project/releases/assets/2';
const update = { available: true, version: '1.0.0', assetUrl, checksumUrl };

for (const scenario of ['asset status', 'manifest status', 'asset URL', 'manifest URL']) {
  for (const mode of ['settled', 'pending', 'throwing']) {
    test(`${scenario} rejects and cancels both unread bodies with ${mode} cancellation`, async () => {
      let cancelled = 0, pulls = 0;
      const responses = [assetUrl, checksumUrl].map((url, index) => {
        const body = new ReadableStream({
          pull() { pulls++; },
          cancel() { cancelled++; if (mode === 'pending') return new Promise(() => {}); if (mode === 'throwing') throw new Error('cleanup failed'); },
        }, { highWaterMark: 0 });
        const affected = scenario.startsWith(index === 0 ? 'asset' : 'manifest');
        return { ok: !(affected && scenario.endsWith('status')), url: affected && scenario.endsWith('URL') ? 'https://rejected.example/file' : url, body };
      });
      let timer;
      try {
        const action = downloadVerifiedUpdate({ update, fetchImpl: async url => responses[url === assetUrl ? 0 : 1] });
        await assert.rejects(Promise.race([action, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cleanup blocked rejection')), 100); })]), scenario.endsWith('status') ? /update download failed/ : /redirect was rejected/);
        assert.equal(cancelled, 2);
        assert.equal(pulls, 0);
        assert.ok(responses.every(response => !response.body.locked));
      } finally { clearTimeout(timer); }
    });
  }
}
