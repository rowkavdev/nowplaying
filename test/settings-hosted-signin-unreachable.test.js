import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVICE_SCRIPT} from '../src/settings-onboarding-page.js';
test('GitHub sign-in explains that GitHub could not be reached',async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'https://cards.example',hidden:true,setAttribute(k,v){this[k]=v},addEventListener(k,fn){this[k]=fn},replaceChildren(){}});return nodes.get(id)};
 runInNewContext(SERVICE_SCRIPT,{document:{getElementById:get},fetch:async path=>path==='/api/settings/services'?{ok:true,json:async()=>({spotify:null,hosted:{url:'https://cards.example'}})}:{ok:false,json:async()=>({status:'unreachable'})},performance:{now:()=>0},setTimeout(){}});
 await new Promise(r=>setImmediate(r));await get('hosted-connect').click();
 assert.equal(get('hosted-service-result').textContent,'GitHub sign-in could not start: Could not reach GitHub. Check your connection and try again.');
});
