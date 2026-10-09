import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHostedEndpoint } from '../src/hosted-preview.js';

for (const mode of ['settled', 'pending', 'throwing']) {
  test(`non-200 health body is cancelled without waiting for ${mode} cleanup`, async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
        if (mode === 'pending') return new Promise(() => {});
        if (mode === 'throwing') throw new Error('fixture cleanup failed');
      },
    });
    let timer;
    try {
      const result = await Promise.race([
        checkHostedEndpoint('https://cards.example', { timeoutMs: 20, fetchImpl: async () => new Response(body, { status: 503 }) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('waited on rejected body cleanup')), 100); }),
      ]);
      assert.deepEqual(result, { ok: false, reason: 'bad_status', status: 503 });
      assert.equal(cancelled, true);
      assert.equal(body.locked, false);
    } finally { clearTimeout(timer); }
  });
}
