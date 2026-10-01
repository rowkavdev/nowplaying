import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('Info text panel is keyboard reachable for scrolling long read-only files',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 assert.match((await h({url:'/settings'})).body,/<pre id="drpp-info-content" role="tabpanel" tabindex="0"/);
});
