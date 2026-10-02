import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVICE_SCRIPT} from '../src/settings-onboarding-page.js';
for(const reason of ['bad_status','not_nowplaying'])test(`a card-service health response of ${reason} explains the wrong endpoint`,async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'https://cards.example',hidden:true,addEventListener(k,fn){this[k]=fn},setAttribute(){},replaceChildren(){}});return nodes.get(id)};
 runInNewContext(SERVICE_SCRIPT,{document:{getElementById:get},fetch:async path=>path==='/api/settings/services'?{ok:true,json:async()=>({spotify:null,hosted:{url:'https://cards.example'}})}:{ok:true,json:async()=>({ok:false,reason})},performance:{now:()=>0},setTimeout(){}});
 await new Promise(r=>setImmediate(r));await get('hosted-check').click();
 assert.equal(get('hosted-service-result').textContent,'Service check failed: That address responded, but not as a NowPlaying card service. Check the card service address.');
});
