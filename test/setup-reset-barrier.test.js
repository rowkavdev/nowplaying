import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSetupDraftStore } from '../src/setup-draft-store.js';
import { createSetupDraftHandler } from '../src/setup-draft-handler.js';
import { createSetupSignInHandler } from '../src/setup-signin-handler.js';

test('#812 reset waits for sign-in outside its draft transaction', { timeout: 2000 }, async () => {
  const store = createSetupDraftStore({ file: join(await mkdtemp(join(tmpdir(), 'reset-barrier-')), 'draft.json') });
  let entered, release;
  const gate = new Promise(resolve => { release = resolve; });
  const saved = new Promise(resolve => { entered = resolve; });
  const signIn = createSetupSignInHandler({ deviceId: 'fixture-device',
    credentialStore: { read: async () => null, remove: async () => true, save: async () => { entered(); await gate; } },
    signIn: { signInNavidrome: async () => ({ provider: 'navidrome', identity: { id: 'fixture', displayName: 'Fixture' }, secret: 'fixture' }) },
    onSignedIn: async () => store.transaction(async () => { const { draft } = await store.load(); await store.save(draft); }) });
  const draft = createSetupDraftHandler({ store, beforeReset: () => signIn.cancelPending() });
  const finishing = signIn({ url: '/api/setup/signin', method: 'POST', body: JSON.stringify({ action: 'password', provider: 'navidrome', baseUrl: 'http://127.0.0.1:4533', username: 'fixture', password: 'fixture' }) });
  await saved;
  let releaseTransaction, enteredTransaction;
  const holding = new Promise(resolve => { releaseTransaction = resolve; });
  const inside = new Promise(resolve => { enteredTransaction = resolve; });
  const prior = store.transaction(async () => { enteredTransaction(); await holding; });
  await inside;
  const reset = draft({ url: '/api/setup/draft', method: 'DELETE' });
  await new Promise(resolve => setImmediate(resolve));
  release();
  await new Promise(resolve => setImmediate(resolve));
  releaseTransaction();
  const [signedIn, cleared] = await Promise.all([finishing, reset, prior]);
  assert.equal(signedIn.status, 410);
  assert.equal(cleared.status, 200);
  assert.equal(JSON.parse(cleared.body).draft.account, null);
});
