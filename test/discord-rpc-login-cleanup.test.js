import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscordRpcTransport} from '../src/discord-rpc.js';
for(const mode of ['sync','async','throwing','rejecting','pending']){
 test(`failed RPC login destroys discarded client (${mode}) and preserves error`,async()=>{
  let destroyed=0,created=0,timer;
  const error=new Error('fixture login failed');
  const factory=()=>({login:async()=>{throw error;},setActivity:async()=>{},clearActivity:async()=>{},destroy:()=>{destroyed++;if(mode==='async')return Promise.resolve();if(mode==='throwing')throw new Error('cleanup');if(mode==='rejecting')return Promise.reject(new Error('cleanup'));if(mode==='pending')return new Promise(()=>{});}});
  const transport=createDiscordRpcTransport({clientId:'123456789012345678',createClient:async()=>{created++;return factory();}});
  try{
   for(let i=1;i<=2;i++){
    await assert.rejects(Promise.race([transport.connect(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cleanup blocked')),100);})]),e=>e===error);
    clearTimeout(timer);assert.equal(destroyed,i);assert.equal(created,i);assert.equal(transport.connected,false);
   }
   await transport.close();assert.equal(destroyed,2);
  }finally{clearTimeout(timer);}
 });
}
test('failed RPC login without destroy preserves error',async()=>{
 const error=new Error('fixture');const transport=createDiscordRpcTransport({clientId:'123456789012345678',createClient:async()=>({login:async()=>{throw error;},setActivity:async()=>{},clearActivity:async()=>{}})});
 await assert.rejects(transport.connect(),e=>e===error);
});
