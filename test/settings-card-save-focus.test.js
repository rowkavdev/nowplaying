import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
for(const ok of [true,false])for(const moved of [true,false])test(`Card Save retains keyboard focus without stealing it (${ok},${moved})`,async()=>{
 const handler=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const script=(await handler({url:'/settings.js'})).body;
 const start=script.indexOf('card.form.addEventListener("submit",');const end=script.indexOf('// YouTube extension pairing',start);
 const document={body:{},activeElement:null};let disabled=false,submit;const save={get disabled(){return disabled},set disabled(v){disabled=v;if(v&&document.activeElement===save)document.activeElement=document.body},focus(){document.activeElement=this}};
 const other={};document.activeElement=save;let resolve,reject;const response=new Promise((a,b)=>{resolve=a;reject=b});
 runInNewContext(script.slice(start,end),{card:{form:{addEventListener(_,fn){submit=fn}},save},document,cardValues:()=>({}),cardValid:()=>true,cardSay(){},showCard(){},hostedCard:null,savedCard:null,send:()=>response});
 const saving=submit({preventDefault(){}});if(moved)document.activeElement=other;if(ok)resolve({card:{}});else reject(Error('save failed'));await saving;
 assert.equal(save.disabled,false);assert.equal(document.activeElement,moved?other:save);
});
