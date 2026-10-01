import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('Hosted copy buttons distinguish the address from README Markdown in their accessible names',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const page=(await h({url:'/settings'})).body;
 assert.match(page,/id="copy-url" aria-label="Copy hosted card address"/);
 assert.match(page,/id="copy-markdown" aria-label="Copy hosted card README Markdown"/);
});
