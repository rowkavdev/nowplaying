import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
for(const cached of [false,true])test(`Info selection starts ${cached?'cached':'fetched'} document at the top`,async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const script=(await h({url:'/settings.js'})).body,start=script.indexOf('async function selectInfoTab(tab)'),end=script.indexOf('document.getElementById("drpp-info-open")',start);
 const tab={id:'readme',dataset:{file:'README.md'},setAttribute(){}};const infoContent={textContent:'previous file',scrollTop:800,setAttribute(){}};
 const ctx={infoContent,infoTabs:[tab],infoCache:new Map(cached?[['README.md','readme text']]:[]),infoRequest:0,fetch:async()=>({ok:true,text:async()=>'readme text'})};runInNewContext(script.slice(start,end)+';globalThis.select=selectInfoTab',ctx);await ctx.select(tab);assert.equal(infoContent.textContent,'readme text');assert.equal(infoContent.scrollTop,0);
});
