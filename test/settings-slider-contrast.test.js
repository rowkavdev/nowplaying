import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('dark Settings shell has a readable range accent independent of system theme',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const css=(await h({url:'/drpp-shell.css'})).body;
 assert.match(css,/\.drpp-shell input\[type=range\]\{accent-color:#7ab8ff\}/);
 const lum=hex=>{const rgb=hex.match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
 assert.ok((lum('7ab8ff')+.05)/(lum('242424')+.05)>=3);
});
