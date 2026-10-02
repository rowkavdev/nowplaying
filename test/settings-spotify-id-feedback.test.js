import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVICE_SCRIPT} from '../src/settings-onboarding-page.js';
for (const error of ['bad_client_id', 'request_failed']) test(`Spotify start feedback explains ${error}`, async () => {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {value: 'not-an-id', hidden: true, addEventListener(event, fn) {this[event] = fn;}, setAttribute() {}, replaceChildren() {}});
    return nodes.get(id);
  };
  runInNewContext(SERVICE_SCRIPT, {document: {getElementById: get}, fetch: async path => path === '/api/settings/services'
    ? {ok: true, json: async () => ({spotify: null, hosted: {url: 'https://cards.example'}})}
    : {ok: false, json: async () => ({error})}, performance: {now: () => 0}, setTimeout() {}});
  await new Promise(resolve => setImmediate(resolve));
  await get('spotify-connect').click();
  assert.equal(get('spotify-service-result').textContent, error === 'bad_client_id'
    ? "Spotify sign-in could not start: Enter the 32-character Client ID from your app in the Spotify developer dashboard."
    : 'Spotify sign-in could not start: request_failed');
});
