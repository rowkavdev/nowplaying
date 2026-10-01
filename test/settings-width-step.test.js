import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
import {normalizeCard} from '../src/setup-config.js';
test('card width input accepts the same whole-pixel widths as the backend',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const html=(await h({url:'/settings'})).body;
 const field=html.match(/<input[^>]*id="card-width"[^>]*>/)[0];assert.match(field,/step="1"/);
 for(const width of [281,441,799])assert.equal(normalizeCard({width}).width,width);
});
