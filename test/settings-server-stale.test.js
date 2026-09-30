import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { SERVER_SCRIPT } from '../src/settings-onboarding-page.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('#826 stale password response leaves replacement sign-in panel alone', async () => {
  for (const provider of ['emby', 'navidrome']) {
    const elements = new Map(), calls = [];
    const node = id => { if (!elements.has(id)) elements.set(id, { value: '', hidden: false, textContent: '', disabled: false, children: [], focus() {}, append() {}, replaceChildren() {}, addEventListener(event, fn) { this[event] = fn; } }); return elements.get(id); };
    runInNewContext(SERVER_SCRIPT, { document: { getElementById: id => id === 'first-run-state' ? null : node(id), createElement: () => node(Math.random()) }, URL, fetch(path, options) { let resolve; const promise = new Promise(r => { resolve = r; }); calls.push({path, options, resolve}); return promise; }, clearTimeout, setTimeout, confirm: () => true });
    calls[0].resolve({ ok: true, json: async () => ({ servers: [] }) }); await tick();
    node('server-provider').value = provider; node('server-url').value = 'http://127.0.0.1:4533';
    node('manual-connect').click({ currentTarget: node('manual-connect') });
    const older = node('signin-button').click();
    await node('signin-cancel').click();
    node('server-provider').value = 'jellyfin'; node('manual-connect').click({ currentTarget: node('manual-connect') });
    node('signin-password').value = 'new-panel-value';
    calls[1].resolve({ ok: true, json: async () => ({ status: 'signed_in', identity: { displayName: 'Old User' } }) }); await tick();
    assert.equal(node('signin-panel').hidden, false);
    assert.equal(node('signin-button').disabled, false, 'replacement panel must allow starting sign-in');
    await older;
    assert.equal(node('signin-panel').hidden, false);
    assert.equal(node('signin-button').disabled, false, 'replacement panel must allow starting sign-in');
    assert.equal(node('signin-title').textContent, 'Connect to Jellyfin');
    assert.equal(node('signin-result').textContent, '');
    assert.equal(node('signin-password').value, 'new-panel-value');
    assert.equal(calls.length, 2, 'stale response must not reload server list');
  }
});
