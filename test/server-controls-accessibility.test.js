import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT,serverPanel,servicePanel} from '../src/settings-onboarding-page.js';
test('each repeated server action names its target for assistive technology',async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,children:[],textContent:'',addEventListener(){},replaceChildren(...children){this.children=children;}});return nodes.get(id);};
 runInNewContext(SERVER_SCRIPT,{
  document:{getElementById:get,createElement:()=>({children:[],textContent:'',append(...children){this.children.push(...children);},addEventListener(){}})},
  fetch:async()=>({ok:true,json:async()=>({servers:[{provider:'plex',name:'Music',baseUrl:'http://127.0.0.1:32400'},{provider:'jellyfin',name:'Films',baseUrl:'http://127.0.0.1:8096'}]})}),setTimeout(){},clearTimeout(){},
 });
 await new Promise(resolve=>setImmediate(resolve));
 const buttons=get('servers-list').children.map(row=>row.children[1]);
 assert.equal(buttons[0].ariaLabel,'Remove Plex - Music - http://127.0.0.1:32400');
 assert.equal(buttons[1].ariaLabel,'Remove Jellyfin - Films - http://127.0.0.1:8096');
});
test('server and service inputs reference their instructions and status',()=>{
 const servers=serverPanel(),services=servicePanel();
 assert.match(servers,/id="scan-subnet"[^>]*aria-describedby="scan-help discovery-state"/);
 assert.match(servers,/id="signin-password"[^>]*aria-describedby="signin-instructions signin-result"/);
 assert.match(services,/id="spotify-client-id"[^>]*aria-describedby="spotify-client-help spotify-service-result"/);
});
