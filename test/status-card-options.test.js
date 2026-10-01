import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createAppStatus } from '../src/app-status.js';
import { createStatusPageHandler } from '../src/status-page-handler.js';
import { createHostedUploader } from '../src/hosted-uploader.js';

const cardUrl = 'https://nowplaying-hosted.vercel.app/u/rowkav09.svg';
async function view(hosted) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, textContent: '', src: '', href: '', addEventListener() {}, replaceChildren() {}, removeAttribute(key) { this[key] = ''; } });
    return nodes.get(id);
  };
  const handle = createStatusPageHandler({ status: { snapshot() {}, async refresh() {} }, fallback: async () => null });
  runInNewContext((await handle({ url: '/status.js' })).body, {
    document: { getElementById: get, createElement: () => ({}) }, URL, Date,
    location: { origin: 'http://127.0.0.1:47832' }, setInterval() {},
    fetch: async () => ({ ok: true, json: async () => ({ server: { state: 'connected' }, discord: { enabled: false }, hosted }) }),
  });
  await new Promise(resolve => setImmediate(resolve));
  return get;
}
test('Status shows separate local and hosted addresses and previews', async () => {
  const get = await view({ enabled: true, state: 'connected', cardUrl });
  assert.equal(get('card-link').textContent, 'http://127.0.0.1:47832/card.svg');
  assert.equal(get('hosted-card-link').href, cardUrl);
  assert.equal(get('hosted-card').hidden, false);
  assert.ok(get('hosted-card').src.startsWith(cardUrl));
});
test('off, pending deletion and unsafe hosted addresses never load remote art', async () => {
  for (const hosted of [ { enabled: false, cardUrl }, { enabled: true, state: 'disconnect_pending', cardUrl }, { enabled: true, state: 'connected', cardUrl: 'javascript:alert(1)' }, { enabled: true, state: 'connected', cardUrl: cardUrl + '?token=secret' } ]) {
    const get = await view(hosted);
    assert.equal(get('hosted-card').hidden, true);
    assert.equal(get('hosted-card').src, '');
    assert.equal(get('hosted-card-link').hidden, true);
    assert.ok(get('hosted-card-note').textContent.length > 0);
  }
});
test('app status exposes only a public card address, not credential-bearing URLs', () => {
  const status = createAppStatus({ config: { provider: 'plex' } });
  status.setHosted(() => ({ enabled: true, state: 'connected', cardUrl, token: 'secret' }));
  assert.equal(status.snapshot().hosted.cardUrl, cardUrl);
  assert.doesNotMatch(JSON.stringify(status.diagnostics()), /rowkav09|secret/);
  for (const url of ['javascript:alert(1)', cardUrl + '?token=secret', 'https://user:secret@example.com/card.svg']) {
    status.setHosted(() => ({ enabled: true, state: 'connected', cardUrl: url }));
    assert.equal(status.snapshot().hosted.cardUrl, undefined);
  }
});
test('app status keeps a hosted address that lives under a base path', () => {
  const status = createAppStatus({ config: { provider: 'plex' } });
  const url = 'https://cards.example/service/u/fixture.svg';
  status.setHosted(() => ({ enabled: true, state: 'connected', cardUrl: url }));
  assert.equal(status.snapshot().hosted.cardUrl, url);
  for (const bad of ['https://cards.example/service/u/fixture.svg#x', 'https://cards.example/a b/u/fixture.svg', 'https://cards.example/service/other.svg']) {
    status.setHosted(() => ({ enabled: true, state: 'connected', cardUrl: bad }));
    assert.equal(status.snapshot().hosted.cardUrl, undefined);
  }
});
test('reading uploader status does not register; after upload it exposes the public card URL', async () => {
  let calls = 0;
  const uploader = createHostedUploader({ credentials: {
    load: async () => ({ baseUrl: 'https://nowplaying-hosted.vercel.app', login: 'rowkav09', deviceId: 'd'.repeat(22), token: 't'.repeat(30) }), save: async () => {}, clear: async () => {},
  }, fetchImpl: async () => { calls++; return Response.json({ ok: true }); } });
  assert.equal(uploader.status().cardUrl, null);
  assert.equal(calls, 0);
  await uploader.push({ state: 'idle' });
  assert.equal(uploader.status().cardUrl, cardUrl);
});
test('only the Status page permits the official hosted preview origin; fonts are local', async () => {
  const { createHttpServer, PAGE_CSP } = await import('../src/http-server.js');
  const handle = createStatusPageHandler({ status: { snapshot() {}, async refresh() {} }, fallback: async () => ({ status: 200, body: '<html></html>', headers: { 'Content-Type': 'text/html; charset=utf-8' }, page: true }) });
  const server = createHttpServer({ handler: handle, port: 0 });
  const address = await server.listen();
  try {
    const origin = `http://127.0.0.1:${address.port}`;
    const policy = (await fetch(origin + '/status')).headers.get('content-security-policy');
    assert.match(policy, /img-src 'self' blob: https:\/\/nowplaying-hosted.vercel.app/);
    assert.match(policy, /connect-src 'self'/);
    assert.match(policy, /font-src 'self'/);
    assert.equal((await fetch(origin + '/settings')).headers.get('content-security-policy'), PAGE_CSP);
    assert.equal((await fetch(origin + '/inter.woff2')).headers.get('content-type'), 'font/woff2');
  } finally { await server.close(); }
});
