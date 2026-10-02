import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
for(const moved of [false,true])test(`hiding hosted details ${moved?'preserves other focus':'returns focus before hiding Copy'}`,async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const script=(await h({url:'/settings.js'})).body,start=script.indexOf('function showHosted(h)'),end=script.indexOf('async function copy(',start);
 const nodes=new Map();const document={activeElement:null,getElementById:id=>{if(!nodes.has(id))nodes.set(id,{id,hidden:false,textContent:'',contains(e){return ['copy-url','copy-markdown','hosted-url'].includes(e?.id)},focus(){document.activeElement=this;}});return nodes.get(id);}};const get=document.getElementById;
 const ctx={document,hosted:{form:{},enabled:get('hosted-enabled'),save:{}},HOSTED_WORDS:{off:['Off',''],connected:['Connected','ok']},hostedLink:url=>url};runInNewContext(script.slice(start,end)+';globalThis.show=showHosted;',ctx);
 ctx.show({enabled:true,state:'connected',cardUrl:'https://cards.example/u/test.svg'});get(moved?'drpp-search':'copy-url').focus();ctx.show({enabled:false,state:'off',cardUrl:'https://cards.example/u/test.svg'});assert.equal(get('hosted-details').hidden,true);assert.equal(document.activeElement,get(moved?'drpp-search':'hosted-enabled'));
});
