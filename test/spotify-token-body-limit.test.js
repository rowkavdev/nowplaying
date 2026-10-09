import test from 'node:test';
import assert from 'node:assert/strict';
import {exchangeCode,refreshAccessToken} from '../src/spotify-auth.js';
const limit=1024*1024;
const common={clientId:'a'.repeat(32),refreshToken:'fixture',code:'fixture',verifier:'fixture',redirectUri:'http://127.0.0.1:4444/cb'};
for(const [name,request] of [['exchange',exchangeCode],['refresh',refreshAccessToken]]){
 for(const declared of [false,true])for(const mode of ['settled','pending','throwing']){
  test(`${name} rejects oversized token body (${declared?'declared':'streamed'}, ${mode})`,async()=>{
   let pulls=0,cancels=0,timer;
   const payload=JSON.stringify({access_token:'fixture',padding:'x'.repeat(limit+100)});
   const chosen=new ReadableStream({pull(c){pulls++;if(pulls===1)c.enqueue(new TextEncoder().encode(payload));},cancel(){cancels++;if(mode==='pending')return new Promise(()=>{});if(mode==='throwing')throw new Error('cleanup');}},{highWaterMark:0});
   try{
    await assert.rejects(Promise.race([request({...common,requestTimeoutMs:1000,fetchImpl:async()=>new Response(chosen,{headers:declared?{'content-length':String(payload.length)}:{}})}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('body cap blocked')),150);})]),e=>e.name==='SpotifyAuthError'&&e.code==='token_failed');
    assert.equal(cancels,1);assert.equal(chosen.locked,false);assert.equal(pulls,declared?0:1);
   }finally{clearTimeout(timer);}
  });
 }
 test(`${name} never calls an unbounded json-only adapter`,async()=>{
  let reads=0;
  await assert.rejects(request({...common,fetchImpl:async()=>({ok:true,status:200,json:async()=>{reads++;return {access_token:'fixture'};}})}),e=>e.code==='token_failed');assert.equal(reads,0);
 });
}
test('exact-cap UTF-8 token JSON succeeds; small invalid_grant stays reauth_needed',async()=>{
 const base=JSON.stringify({access_token:'fixture',padding:''});
 const payload=JSON.stringify({access_token:'fixture',padding:'é'.repeat(Math.floor((limit-Buffer.byteLength(base))/2))+'x'.repeat((limit-Buffer.byteLength(base))%2)});
 assert.equal(Buffer.byteLength(payload),limit);
 assert.equal((await refreshAccessToken({...common,fetchImpl:async()=>new Response(payload)})).accessToken,'fixture');
 await assert.rejects(refreshAccessToken({...common,fetchImpl:async()=>new Response('{"error":"invalid_grant"}',{status:400})}),e=>e.code==='reauth_needed'&&e.status===401);
});
test('stalled streamed token body times out and releases reader',async()=>{
 let cancels=0;
 const body=new ReadableStream({cancel(){cancels++;return new Promise(()=>{});}},{highWaterMark:0});
 await assert.rejects(refreshAccessToken({...common,requestTimeoutMs:20,fetchImpl:async()=>new Response(body)}),e=>e.code==='token_failed'&&/timed out/.test(e.message));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(cancels,1);assert.equal(body.locked,false);
});
test('streamed cap stops chunk accumulation despite an understated content-length',async()=>{
 let pulls=0,cancels=0;
 const chunk=new Uint8Array(65536);chunk.fill(32);
 const body=new ReadableStream({pull(c){pulls++;c.enqueue(chunk);},cancel(){cancels++;}},{highWaterMark:0});
 await assert.rejects(refreshAccessToken({...common,fetchImpl:async()=>new Response(body,{headers:{'content-length':'1'}})}),e=>e.code==='token_failed');
 assert.equal(pulls,17);assert.equal(cancels,1);assert.equal(body.locked,false);
});
