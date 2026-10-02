import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
const tick=()=>new Promise(r=>setImmediate(r));
for(const id of ['signin-username','signin-password'])test(`Enter in ${id} submits password sign-in once`,async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,children:[],addEventListener(e,f){this[e]=f},setAttribute(){},replaceChildren(...c){this.children=c},append(){},contains(){return false},focus(){},click(){return this.listenersClick?.()},});return nodes.get(id)};
 const old=get;for(const id of ['signin-button']){const n=get(id);n.addEventListener=(e,f)=>{if(e==='click')n.listenersClick=f;else n[e]=f;};}
 let passwords=0;runInNewContext(SERVER_SCRIPT,{document:{getElementById:id=>id==='first-run-state'?null:old(id),createElement:()=>({append(){},addEventListener(){}})},fetch:async(path,options)=>{if(path==='/api/setup/signin'&&JSON.parse(options.body).action==='password')passwords++;return {ok:true,json:async()=>path==='/api/settings/servers'?{servers:[]}:{status:'denied'}}},URL,setTimeout,clearTimeout,confirm:()=>true,window:{open(){}}});
 await tick();get('server-provider').value='navidrome';get('server-url').value='http://192.168.1.2:4533';await get('manual-connect').click({currentTarget:get('manual-connect')});
 let prevented=false;get(id).keydown?.({key:'Enter',isComposing:false,preventDefault(){prevented=true}});await tick();assert.equal(passwords,1);assert.equal(prevented,true);
 get('signin-button').disabled=true;get(id).keydown?.({key:'Enter',preventDefault(){}});await tick();assert.equal(passwords,1);
});
