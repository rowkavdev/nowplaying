import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('bar ends follows the other disabled progress controls while preserving its choice',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const script=(await h({url:'/settings.js'})).body;
 const start=script.indexOf('function cardChanged()');const end=script.indexOf('function showCard(',start);
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='card-progressStyle'?'rounded':'24',checked:false,disabled:false,textContent:'',hidden:false});return nodes.get(id);};
 const ctx={document:{getElementById:get},cardField:key=>get('card-'+key),card:{scaleNote:{}},ART_AUTO:{},clearTimeout(){},setTimeout(){},previewTimer:null,previewGeneration:0,previewRequest:null};
 runInNewContext(script.slice(start,end)+';globalThis.change=cardChanged;',ctx);
 ctx.change();assert.equal(get('card-progressStyle').disabled,true);assert.equal(get('card-progressStyle').value,'rounded');
 get('card-showProgress').checked=true;ctx.change();assert.equal(get('card-progressStyle').disabled,false);assert.equal(get('card-progressStyle').value,'rounded');
});
