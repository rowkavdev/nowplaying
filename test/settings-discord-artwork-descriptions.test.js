import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('Discord artwork controls expose their external sharing explanations as descriptions',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const html=(await h({url:'/settings'})).body;
 for(const [control,help] of [['discord-upload','discord-upload-help'],['discord-artwork','discord-artwork-help']]){assert.match(html,new RegExp('id="'+control+'"[^>]*aria-describedby="'+help+'"'));assert.match(html,new RegExp('<p class="hint" id="'+help+'">'));}
});
