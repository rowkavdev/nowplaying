import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('long Hosted device names and account names wrap within Configuration',async()=>{const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});assert.match((await h({url:'/drpp-shell.css'})).body,/\.drpp-shell #hosted-devices\{overflow-wrap:anywhere\}/)});
