import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('Info panel focus ring is inset so its dialog cannot clip it',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const css=(await h({url:'/drpp-shell.css'})).body;
 assert.match(css,/\.drpp-shell #drpp-info-content:focus-visible\{outline-offset:-3px\}/);
});
