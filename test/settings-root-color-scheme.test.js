import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('the Settings root declares dark native chrome, without changing other pages',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 assert.match((await h({url:'/settings'})).body,/<html lang="en" class="drpp-root">/);
 assert.match((await h({url:'/drpp-shell.css'})).body,/html\.drpp-root\{color-scheme:dark\}/);
});
