import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVICE_SCRIPT} from '../src/settings-onboarding-page.js';
for(const action of ['check','connect'])test(`hosted ${action} marks invalid URLs and clears on retry`,async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'http://cards.example',hidden:true,attrs:{},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this[k]=fn},replaceChildren(){}});return nodes.get(id)};let invalid=true;runInNewContext(SERVICE_SCRIPT,{document:{getElementById:get},fetch:async path=>path==='/api/settings/services'?{ok:true,json:async()=>({spotify:null,hosted:{url:'http://cards.example'}})}:{ok:action==='check',json:async()=>action==='check'?{ok:false,reason:invalid?'invalid_url':'unreachable'}:{status:invalid?'invalid_url':'no_credential_store'}},performance:{now:()=>0},setTimeout(){}});await new Promise(r=>setImmediate(r));await get('hosted-'+action).click();assert.equal(get('hosted-address').attrs['aria-invalid'],'true');invalid=false;await get('hosted-'+action).click();assert.equal(get('hosted-address').attrs['aria-invalid'],'false');
});
