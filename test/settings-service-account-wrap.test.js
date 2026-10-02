import test from 'node:test';
import assert from 'node:assert/strict';
import {SERVER_CSS} from '../src/settings-onboarding-page.js';
test('connected service account names wrap within Settings and first-run panels',()=>{assert.match(SERVER_CSS,/#spotify-account,#hosted-account\{overflow-wrap:anywhere\}/)});
