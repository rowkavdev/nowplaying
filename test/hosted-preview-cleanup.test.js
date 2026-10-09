import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHostedEndpoint } from '../src/hosted-preview.js';

async function promptly(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('endpoint check stuck on cleanup')), 100); })]); }
  finally { clearTimeout(timer); }
}

for (const mode of ['pending', 'throwing']) {
  test(`oversized health response does not await ${mode} cancel`, async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(1025)); },
      cancel() { cancelled = true; if (mode === 'throwing') throw new Error('cleanup failed'); return new Promise(() => {}); },
    });
    const result = await promptly(checkHostedEndpoint('https://cards.example', { timeoutMs: 20, fetchImpl: async () => new Response(body) }));
    assert.equal(result.reason, 'not_nowplaying');
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  });
}

for (const scenario of ['success', 'read error', 'declared overflow']) {
  test(`health response releases body after ${scenario}`, async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(c) { if (scenario === 'read error') c.error(new Error('read failed')); else if (scenario === 'success') { c.enqueue(new TextEncoder().encode('ok')); c.close(); } },
      cancel() { cancelled = true; },
    });
    const headers = scenario === 'declared overflow' ? { 'content-length': '1025' } : {};
    const result = await promptly(checkHostedEndpoint('https://cards.example', { fetchImpl: async () => new Response(body, { headers }) }));
    assert.equal(scenario === 'success' ? result.ok : result.reason, scenario === 'success' ? true : scenario === 'read error' ? 'unreachable' : 'not_nowplaying');
    assert.equal(body.locked, false);
    if (scenario === 'declared overflow') assert.equal(cancelled, true);
  });
}
