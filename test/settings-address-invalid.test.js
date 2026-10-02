import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('manual address rejection identifies its input and a valid retry clears it',async()=>{
 const nodes=new Map();let fetchResolve;const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(e,f){this[e]=f;},replaceChildren(){},focus(){}});return nodes.get(id);};
 runInNewContext(SERVER_SCRIPT,{document:{getElementById:get,createElement:()=>({append(){}})},fetch:()=>new Promise(resolve=>fetchResolve=resolve),setTimeout:()=>1,clearTimeout(){},URL});fetchResolve({ok:true,json:async()=>({servers:[]})});await tick();
 for(const invalid of ['','ftp://example.com','http://user:password@example.com','http://example.com?query=1']){get('server-url').value=invalid;get('manual-connect').click({currentTarget:get('manual-connect')});assert.equal(get('server-url').attrs['aria-invalid'],'true');assert.match(get('discovery-state').textContent,/full http/);}
 get('server-url').value='http://192.168.1.20:8096';get('server-provider').value='emby';get('manual-connect').click({currentTarget:get('manual-connect')});assert.equal(get('server-url').attrs['aria-invalid'],'false');assert.equal(get('signin-panel').hidden,false);
});
