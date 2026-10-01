import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('Settings units and preview labels use the fixed dark secondary text palette',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const css=(await h({url:'/drpp-shell.css'})).body;
 assert.match(css,/\.drpp-config \.unit,\.drpp-config \.preview-label\{color:#a8a9ae\}/);
});
