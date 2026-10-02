import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVICE_SCRIPT} from '../src/settings-onboarding-page.js';
for(const action of ['check','connect'])test(`hosted ${action} explains an invalid service address`,async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'http://cards.example',hidden:true,addEventListener(k,fn){this[k]=fn},setAttribute(){},replaceChildren(){}});return nodes.get(id)};
 runInNewContext(SERVICE_SCRIPT,{document:{getElementById:get},fetch:async path=>path==='/api/settings/services'?{ok:true,json:async()=>({spotify:null,hosted:{url:'http://cards.example'}})}:{ok:action==='check',json:async()=>action==='check'?{ok:false,reason:'invalid_url'}:{status:'invalid_url'}},performance:{now:()=>0},setTimeout(){}});
 await new Promise(r=>setImmediate(r));await get('hosted-'+action).click();
 assert.equal(get('hosted-service-result').textContent,(action==='check'?'Service check failed: ':'GitHub sign-in could not start: ')+'Enter an HTTPS card service address. Use HTTP only for localhost, 127.0.0.1 or [::1].');
});
