import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('Settings feedback tones use the fixed dark palette even with a light OS preference',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const css=(await h({url:'/drpp-shell.css'})).body;
 assert.match(css,/\.drpp-shell \.ok\{color:#7ab8ff\}/);
 assert.match(css,/\.drpp-shell \.bad\{color:#ffa552/);
 assert.match(css,/\.drpp-shell \.warn\{color:#e0d070\}/);
});
