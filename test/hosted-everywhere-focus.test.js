import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {HOSTED_DEVICES_SCRIPT} from '../src/hosted-devices.js';
for(const moved of [false,true])test(`sign out everywhere ${moved?'preserves focus moved outside':'returns focus before hiding the devices section'}`,async()=>{
 const nodes=new Map();let doc;const make=()=>({hidden:false,textContent:'',children:[],listeners:{},addEventListener(e,fn){this.listeners[e]=fn},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},focus(){doc.activeElement=this},contains(node){return this===node||this.children.some(c=>c.contains(node))}});const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id)};const container=make();doc={getElementById:get,createElement:make,querySelector:()=>container,activeElement:null};get('hosted-devices').append(get('hosted-devices-list'),get('hosted-devices-everywhere'));let calls=0,resolve;
 runInNewContext(HOSTED_DEVICES_SCRIPT,{document:doc,fetch:async()=>++calls===1?new Response(JSON.stringify({signedIn:true,login:'fixture',devices:[]})):await new Promise(r=>resolve=r),TextDecoder,Uint8Array,Date,confirm:()=>true});await new Promise(r=>setImmediate(r));const button=get('hosted-devices-everywhere');button.focus();button.listeners.click();if(moved)get('outside').focus();resolve(new Response(JSON.stringify({signedIn:false,devices:[]})));await new Promise(r=>setImmediate(r));assert.equal(get('hosted-devices').hidden,true);assert.equal(doc.activeElement,moved?get('outside'):container);
});
