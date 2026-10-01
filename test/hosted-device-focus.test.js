import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {HOSTED_DEVICES_SCRIPT} from '../src/hosted-devices.js';
test('renaming a device restores focus to its replacement button after the list rerenders',async()=>{
 const nodes=new Map();let doc;const make=()=>({hidden:false,textContent:'',children:[],listeners:{},addEventListener(e,fn){this.listeners[e]=fn},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},focus(){doc.activeElement=this},contains(node){return this===node||this.children.some(c=>c.contains(node))}});const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id)};
 doc={getElementById:get,createElement:make,activeElement:null};let calls=0;
 runInNewContext(HOSTED_DEVICES_SCRIPT,{document:doc,fetch:async()=>new Response(JSON.stringify({signedIn:true,login:'fixture',devices:[{deviceId:'a',name:++calls===1?'Office PC':'Renamed PC'}]})),TextDecoder,Uint8Array,Date,prompt:()=> 'Renamed PC'});
 await new Promise(r=>setImmediate(r));const old=get('hosted-devices-list').children[0].children[2];old.focus();old.listeners.click();await new Promise(r=>setImmediate(r));
 assert.notEqual(get('hosted-devices-list').children[0].children[2],old);
 assert.equal(doc.activeElement,get('hosted-devices-list').children[0].children[2]);
});
