import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVICE_SCRIPT} from '../src/settings-onboarding-page.js';
test('hosted sign-in rate limit explains why the user should wait',async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'https://cards.example',hidden:true,addEventListener(k,fn){this[k]=fn},setAttribute(){},replaceChildren(){}});return nodes.get(id)};
 const say=(id,text)=>get(id).textContent=text;
 const start=SERVICE_SCRIPT.indexOf('async function pollHosted(');const end=SERVICE_SCRIPT.lastIndexOf('load();');
 const context={$:get,say,hostedFlow:true,hostedGeneration:1,api:async()=>({status:'rate_limited'}),load(){throw Error('should not load after rate limit')}};
 runInNewContext(SERVICE_SCRIPT.slice(start,end),context);await context.pollHosted(1);
 assert.equal(get('hosted-service-result').textContent,'GitHub sign-in failed: The card service received too many sign-in requests. Wait a while before signing in again.');
 assert.equal(context.hostedFlow,false);
});
