import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('Settings explains invalid custom fonts and styles the field with other controls',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const script=(await h({url:'/settings.js'})).body;
 const start=script.indexOf('function customFontValid('),end=script.indexOf('// Read the actual SVG',start);
 const ctx={CARD_NUMBERS:{width:[280,800]},ART_AUTO:{}};
 runInNewContext(script.slice(start,end)+';globalThis.valid=cardValid;',ctx);
 assert.equal(ctx.valid({width:440,fontStack:'Inter, Segoe UI'}),true);
 assert.equal(ctx.valid({width:440,fontStack:'"Inter"'}),false);
 assert.equal(ctx.valid({width:440,fontStack:'Inter; color:red'}),false);
 assert.equal(ctx.valid({width:440,fontStack:''}),true);
 const page=(await h({url:'/settings'})).body;assert.match(page,/id="card-fontStack"[^>]*aria-describedby="card-font-help card-font-error"/);
 const css=(await h({url:'/drpp-shell.css'})).body;assert.match(css,/\.drpp-shell input\[type=text\]/);
});
