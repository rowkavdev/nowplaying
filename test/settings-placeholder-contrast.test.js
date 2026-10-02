import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('Settings placeholder hints have normal-text contrast on the dark field background',async()=>{
 const handler=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const css=(await handler({url:'/drpp-shell.css'})).body;
 const rule=css.match(/\.drpp-shell input::placeholder\{color:(#[0-9a-f]{6});opacity:1\}/);
 assert.ok(rule,'explicit opaque placeholder color avoids low-contrast browser defaults');
 const lum=hex=>{const rgb=hex.replace('#','').match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
 assert.ok((lum(rule[1])+.05)/(lum('#2e2e2e')+.05)>=4.5);
});
