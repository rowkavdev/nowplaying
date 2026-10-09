import test from 'node:test';
import assert from 'node:assert/strict';
import {getSpotifyProfile} from '../src/spotify-signin.js';
const limit=1024*1024;
for(const status of [401,503])for(const mode of ['settled','pending','throwing']){
 test(`profile ${status} cancels unread body (${mode})`,async()=>{
  let cancels=0,pulls=0,timer;
  const body=new ReadableStream({pull(){pulls++;},cancel(){cancels++;if(mode==='pending')return new Promise(()=>{});if(mode==='throwing')throw new Error('cleanup');}},{highWaterMark:0});
  try{
   await assert.rejects(Promise.race([getSpotifyProfile({accessToken:'fixture',fetchImpl:async()=>new Response(body,{status})}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cleanup blocked')),100);})]),e=>e.code==='profile_failed');
   assert.equal(cancels,1);assert.equal(pulls,0);assert.equal(body.locked,false);
  }finally{clearTimeout(timer);}
 });
}
for(const declared of [true,false])for(const mode of ['settled','pending','throwing']){
 test(`profile byte cap (${declared?'declared':'streamed'}, ${mode})`,async()=>{
  let cancels=0,pulls=0,timer;
  const payload=JSON.stringify({id:'fixture',padding:'x'.repeat(limit)});
  const body=new ReadableStream({pull(c){pulls++;if(pulls===1)c.enqueue(new TextEncoder().encode(payload));},cancel(){cancels++;if(mode==='pending')return new Promise(()=>{});if(mode==='throwing')throw new Error('cleanup');}},{highWaterMark:0});
  try{
   await assert.rejects(Promise.race([getSpotifyProfile({accessToken:'fixture',fetchImpl:async()=>new Response(body,{headers:declared?{'content-length':String(payload.length)}:{}})}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cap blocked')),100);})]),e=>e.code==='profile_failed');
   assert.equal(cancels,1);assert.equal(pulls,declared?0:1);assert.equal(body.locked,false);
  }finally{clearTimeout(timer);}
 });
}
test('profile rejects json-only adapters without calling json',async()=>{
 let reads=0;await assert.rejects(getSpotifyProfile({accessToken:'fixture',fetchImpl:async()=>({ok:true,json:async()=>{reads++;return {id:'fixture'};}})}),e=>e.code==='profile_failed');assert.equal(reads,0);
});
test('malformed profile JSON retains profile_failed',async()=>{
 await assert.rejects(getSpotifyProfile({accessToken:'fixture',fetchImpl:async()=>new Response('{')}),e=>e.code==='profile_failed');
});
test('exact-cap UTF8 profile keeps identity trim/fallback/freeze',async()=>{
 const base=JSON.stringify({id:' fixture ',display_name:' ',padding:''});const remaining=limit-Buffer.byteLength(base);
 const payload=JSON.stringify({id:' fixture ',display_name:' ',padding:'é'.repeat(Math.floor(remaining/2))+'x'.repeat(remaining%2)});
 assert.equal(Buffer.byteLength(payload),limit);
 const result=await getSpotifyProfile({accessToken:'fixture',fetchImpl:async()=>new Response(payload)});
 assert.deepEqual(result,{id:'fixture',displayName:'fixture'});assert.equal(Object.isFrozen(result),true);
});
