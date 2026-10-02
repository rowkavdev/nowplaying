import test from 'node:test';
import assert from 'node:assert/strict';
import {SERVER_CSS} from '../src/settings-onboarding-page.js';
test('server feedback wraps long connected account names and server codes within the panel',()=>{assert.match(SERVER_CSS,/#discovery-state\{overflow-wrap:anywhere\}/)});
