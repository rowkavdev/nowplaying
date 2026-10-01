import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('service inputs and dividers use the fixed Settings dark palette regardless of OS preference',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const css=(await h({url:'/drpp-shell.css'})).body;
 for(const selector of ['input[type=url]','input[type=password]','input:not([type])'])assert.ok(css.includes('.drpp-shell '+selector+'{font:inherit')||css.includes('.drpp-shell '+selector+',')||css.includes('.drpp-shell '+selector+'{font:inherit'));
 assert.match(css,/#services-section>div\{border-color:#373a40\}/);
});
