import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('card width identifies bounds and exposes invalid state during preview validation',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const html=(await h({url:'/settings'})).body;
 assert.match(html,/<input[^>]*id="card-width"[^>]*aria-describedby="card-width-help card-result"/);assert.match(html,/<span[^>]*id="card-width-help"/);
 const script=(await h({url:'/settings.js'})).body,start=script.indexOf('function cardChanged()'),end=script.indexOf('function showCard(',start);
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'24',checked:true,attrs:{},textContent:'',setAttribute(k,v){this.attrs[k]=v;}});return nodes.get(id);};let callback;let values={width:801,fontStack:''};
 const ctx={document:{getElementById:get},cardField:key=>get('card-'+key),ART_AUTO:{},CARD_NUMBERS:{width:[280,800]},card:{save:{},scaleNote:{}},previewGeneration:0,previewTimer:null,previewRequest:null,setTimeout:f=>{callback=f;return 1},clearTimeout(){},cardValues:()=>values,customFontValid:()=>true,cardValid:()=>false,cardSay(){}};
 runInNewContext(script.slice(start,end)+';globalThis.changed=cardChanged;',ctx);
 for(const [width,invalid] of [[801,true],[279,true],[440.5,true],[440,false]]){values={width,fontStack:''};ctx.changed();await callback();assert.equal(get('card-width').attrs['aria-invalid'],String(invalid));}
});
