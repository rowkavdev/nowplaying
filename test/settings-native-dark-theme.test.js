import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('Settings advertises its always-dark surface to native controls and scrollbars',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const css=(await h({url:'/drpp-shell.css'})).body;
 assert.match(css,/body\.drpp-shell\{[^}]*color-scheme:dark/);
});
