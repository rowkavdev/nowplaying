import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('log connection dot exposes its changing accessible name as an image',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});assert.match((await h({url:'/settings'})).body,/<span class="drpp-indicator" id="drpp-log-indicator" role="img" aria-label="Log connection status"/);
});
