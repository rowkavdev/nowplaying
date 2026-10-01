import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {HOSTED_DEVICES_SCRIPT} from '../src/hosted-devices.js';
test('each hosted device action names its target for screen readers',async()=>{
 const nodes=new Map();const make=()=>({hidden:false,textContent:'',children:[],addEventListener(){},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items}});const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id)};
 runInNewContext(HOSTED_DEVICES_SCRIPT,{document:{getElementById:get,createElement:make},fetch:async()=>new Response(JSON.stringify({signedIn:true,login:'fixture',devices:[{deviceId:'a',name:'Office PC'},{deviceId:'b',name:'Laptop',current:true}]})),TextDecoder,Uint8Array,Date});
 await new Promise(r=>setImmediate(r));
 const rows=get('hosted-devices-list').children;
 assert.equal(rows[0].children[2].ariaLabel,'Rename Office PC');
 assert.equal(rows[0].children[3].ariaLabel,'Sign out Office PC');
 assert.equal(rows[1].children[2].ariaLabel,'Rename Laptop');
 assert.equal(rows[1].children[3].ariaLabel,'Sign out Laptop (this PC)');
});
