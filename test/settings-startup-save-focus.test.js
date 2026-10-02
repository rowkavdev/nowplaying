import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
for(const ok of [true,false])for(const moved of [true,false])test(`Startup Save retains keyboard focus without stealing it (${ok},${moved})`,async()=>{
 const handler=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const script=(await handler({url:'/settings.js'})).body;
 const start=script.indexOf('startup.form.addEventListener("submit",');const end=script.indexOf('const HOSTED_WORDS',start);
 const document={body:{},activeElement:null};let disabled=false;const save={get disabled(){return disabled},set disabled(v){disabled=v;if(v&&document.activeElement===save)document.activeElement=document.body},focus(){document.activeElement=this}};
 const other={};document.activeElement=save;let submit;let resolve;const response=new Promise(r=>resolve=r);
 const field={checked:true,value:'both'};runInNewContext(script.slice(start,end),{form:{addEventListener(_,fn){submit=fn}},document,startup:{form:{addEventListener(_,fn){submit=fn}},enabled:{checked:true},save},startupSay(){},showStartup(){},applyStartupState(){},fetch:()=>response});
 const saving=submit({preventDefault(){}});if(moved)document.activeElement=other;resolve({ok,status:500,json:async()=>({discord:{}})});await saving;
 assert.equal(save.disabled,false);assert.equal(document.activeElement,moved?other:save);
});
