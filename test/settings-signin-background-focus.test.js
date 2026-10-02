import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
for(const moved of [false,true])test(`server sign-in success ${moved?'preserves focus outside its panel':'returns panel focus to the Connect trigger'}`,async()=>{
 const nodes=new Map();let doc;const get=id=>{if(!nodes.has(id))nodes.set(id,{id,hidden:false,isConnected:true,textContent:'',contains(e){return ['signin-button','signin-cancel','signin-open-link'].includes(e?.id)},focus(){doc.activeElement=this},replaceChildren(){}});return nodes.get(id)};doc={getElementById:id=>id==='first-run-state'?null:get(id),activeElement:get(moved?'drpp-search':'signin-cancel')};
 const context={document:doc,$:doc.getElementById,showAuthLink(){},say(id,text){get(id).textContent=text},load:async()=>{},returnFocus:get('manual-connect'),setTimeout(){}};
 const start=SERVER_SCRIPT.indexOf('async function finish(result)'),end=SERVER_SCRIPT.indexOf("$('discover-servers').addEventListener",start);runInNewContext(SERVER_SCRIPT.slice(start,end)+';globalThis.finish=finish;',context);await context.finish({status:'signed_in',identity:{displayName:'fixture'}});
 assert.equal(get('signin-panel').hidden,true);assert.equal(doc.activeElement,get(moved?'drpp-search':'manual-connect'));
});
