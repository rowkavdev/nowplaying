import test from 'node:test';
import assert from 'node:assert/strict';
import {SERVER_CSS} from '../src/settings-onboarding-page.js';
test('Hosted sign-in result wraps custom service card addresses within the panel',()=>{assert.match(SERVER_CSS,/#hosted-service-result\{overflow-wrap:anywhere\}/)});
