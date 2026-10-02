import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('Settings hosted details hidden state overrides the shared definition-list grid',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const css=(await h({url:'/drpp-shell.css'})).body;assert.match(css,/\.drpp-shell #hosted-details\[hidden\]\{display:none\}/);
});
