import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('an invalid subnet is identified on its field and clears on the next scan',async()=>{
 const fetches=[], nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},addEventListener(e,f){this[e]=f;},replaceChildren(){},focus(){}});return nodes.get(id);};
 runInNewContext(SERVER_SCRIPT,{document:{getElementById:get,createElement:()=>({append(){}})},fetch:()=>new Promise(resolve=>fetches.push((body,ok=true)=>resolve({ok,json:async()=>body}))),setTimeout:()=>1,clearTimeout(){},URL});
 fetches[0]({servers:[]});await tick();get('scan-subnet').value='not-a-subnet';const scan=get('discover-servers').click();fetches[1]({error:'invalid_subnet'},false);await scan;assert.equal(get('scan-subnet').attrs['aria-invalid'],'true');assert.match(get('discovery-state').textContent,/private subnet/);
 get('scan-subnet').value='192.168.1.0/24';const retry=get('discover-servers').click();assert.equal(get('scan-subnet').attrs['aria-invalid'],'false');fetches[2]({servers:[]});await retry;
});
