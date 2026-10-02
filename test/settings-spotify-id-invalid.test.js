import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVICE_SCRIPT} from '../src/settings-onboarding-page.js';
test('Spotify Client ID invalid state follows bad_client_id and clears on a retry',async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'not-an-id',hidden:true,attrs:{},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this[k]=fn},replaceChildren(){}});return nodes.get(id)};let fail=true;runInNewContext(SERVICE_SCRIPT,{document:{getElementById:get},fetch:async path=>path==='/api/settings/services'?{ok:true,json:async()=>({spotify:null,hosted:{url:'https://cards.example'}})}:{ok:false,json:async()=>({error:fail?'bad_client_id':'request_failed'})},performance:{now:()=>0},setTimeout(){}});await new Promise(r=>setImmediate(r));await get('spotify-connect').click();assert.equal(get('spotify-client-id').attrs['aria-invalid'],'true');fail=false;await get('spotify-connect').click();assert.equal(get('spotify-client-id').attrs['aria-invalid'],'false');
});
