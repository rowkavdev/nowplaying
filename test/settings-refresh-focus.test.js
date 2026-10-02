import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
for(const ok of [true,false])for(const moved of [true,false])test(`Refresh album art retains keyboard focus without stealing it (${ok},${moved})`,async()=>{
 const handler=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const script=(await handler({url:'/settings.js'})).body;
 const start=script.indexOf('document.getElementById("refresh-art").addEventListener');const end=script.indexOf('const PRIVACY_KEYS',start);
 const document={body:{},activeElement:null};let disabled=false,click;const button={addEventListener(_,fn){click=fn},get disabled(){return disabled},set disabled(v){disabled=v;if(v&&document.activeElement===button)document.activeElement=document.body},focus(){document.activeElement=this}};
 document.getElementById=id=>id==='refresh-art'?button:{};const other={};document.activeElement=button;let resolve;const response=new Promise(r=>resolve=r);
 runInNewContext(script.slice(start,end),{document,fields:{enabled:{checked:true}},fetch:()=>response});
 const saving=click({currentTarget:button});if(moved)document.activeElement=other;resolve({ok,status:500,json:async()=>({})});await saving;
 assert.equal(button.disabled,false);assert.equal(document.activeElement,moved?other:button);
});
