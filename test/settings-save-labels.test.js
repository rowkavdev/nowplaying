import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('each Settings Save button names the section in the accessible button list',async()=>{
 const handler=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const html=(await handler({url:'/settings'})).body;
 for(const [key,section] of [['discord','Discord'],['privacy','privacy'],['card','card'],['startup','startup'],['hosted','hosted card']]) {
  const button=html.match(new RegExp('<button[^>]*id="'+key+'-save"[^>]*>Save</button>'))?.[0];
  assert.ok(button,key+' Save button exists');
  assert.ok(button.includes('aria-label="Save '+section+' settings"'),key+' Save has a distinct name');
 }
});
