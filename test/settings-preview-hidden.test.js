import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('a hidden card preview image stays hidden, so a failed preview never shows its alt text',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const css=(await h({url:'/settings.css'})).body;
 assert.match(css,/\.preview img\[hidden\]\{display:none\}/);
 const html=(await h({url:'/settings'})).body;
 assert.match(html,/<img id="card-preview" alt="[^"]*" hidden>/);
});
