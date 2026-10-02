import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('Settings input and select boundaries remain visible against both adjoining dark colors',async()=>{
 const handler=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const css=(await handler({url:'/drpp-shell.css'})).body;
 const rule=css.match(/\.drpp-shell input:not\(\[type=checkbox\]\):not\(\[type=range\]\),\.drpp-shell select\{border-color:(#[0-9a-f]{6})\}/);
 assert.ok(rule,'a dedicated high-contrast field boundary override exists');
 const lum=hex=>{const rgb=hex.replace('#','').match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
 for(const background of ['#242424','#2e2e2e'])assert.ok((lum(rule[1])+.05)/(lum(background)+.05)>=3,background);
});
