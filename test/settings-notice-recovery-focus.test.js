import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
for(const moved of [false,true])test(`recovering server notice ${moved?'preserves other focus':'returns focus before hiding its link'}`,async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const script=(await h({url:'/settings.js'})).body,start=script.indexOf('async function refreshVersion()'),end=script.indexOf('// Setup notice navigation',start);
 const nodes=new Map();const document={activeElement:null,getElementById:id=>{if(!nodes.has(id))nodes.set(id,{id,hidden:false,textContent:'',contains(e){return e?.id==='drpp-setup-action';},focus(){document.activeElement=this;}});return nodes.get(id);}};const get=document.getElementById;let state='error';
 const ctx={document,fetch:async()=>({ok:true,json:async()=>({version:'test',server:{state,type:'Plex'}})})};runInNewContext(script.slice(start,end)+';globalThis.reload=refreshVersion;',ctx);
 await ctx.reload();get(moved?'drpp-search':'drpp-setup-action').focus();state='connected';await ctx.reload();assert.equal(get('drpp-setup').hidden,true);assert.equal(document.activeElement,get(moved?'drpp-search':'settings-content'));
});
