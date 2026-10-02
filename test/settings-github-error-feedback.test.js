import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVICE_SCRIPT} from '../src/settings-onboarding-page.js';
test('GitHub start explains an unsuccessful GitHub response',async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'https://cards.example',hidden:true,setAttribute(k,v){this[k]=v},addEventListener(k,fn){this[k]=fn},replaceChildren(){}});return nodes.get(id)};
 runInNewContext(SERVICE_SCRIPT,{document:{getElementById:get},fetch:async path=>path==='/api/settings/services'?{ok:true,json:async()=>({spotify:null,hosted:{url:'https://cards.example'}})}:{ok:false,json:async()=>({status:'github_error'})},performance:{now:()=>0},setTimeout(){}});
 await new Promise(r=>setImmediate(r));await get('hosted-connect').click();
 assert.equal(get('hosted-service-result').textContent,'GitHub sign-in could not start: GitHub could not complete sign-in. Try signing in again.');
});

test('GitHub poll explains an unsuccessful GitHub response',async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'https://cards.example',hidden:true,addEventListener(k,fn){this[k]=fn},replaceChildren(){}});return nodes.get(id)};
 const say=(id,text)=>get(id).textContent=text;
 const start=SERVICE_SCRIPT.indexOf('async function pollHosted(');const end=SERVICE_SCRIPT.lastIndexOf('load();');
 const context={$:get,say,hostedFlow:true,hostedGeneration:1,api:async()=>({status:'github_error'}),load(){throw Error('should not load after rate limit')}};
 runInNewContext(SERVICE_SCRIPT.slice(start,end),context);await context.pollHosted(1);
 assert.equal(get('hosted-service-result').textContent,'GitHub sign-in failed: GitHub could not complete sign-in. Try signing in again.');
 assert.equal(context.hostedFlow,false);
});
