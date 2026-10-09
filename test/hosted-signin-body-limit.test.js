import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedGitHubSignIn} from '../src/hosted-signin.js';
const limit=1024*1024;
const replies={device:{device_code:'fixture',user_code:'CODE',verification_uri:'https://github.com/login/device',interval:5,expires_in:900},token:{access_token:'fixture'},hosted:{login:'fixture',deviceId:'fixture',token:'fixture'}};
function setup(target,makeResponse){
 let clock=0;const saves=[],calls=[];
 const signIn=createHostedGitHubSignIn({baseUrl:'https://cards.example',clientId:'fixture',now:()=>clock,credentials:{load:async()=>null,save:async v=>saves.push(v)},fetchImpl:async url=>{
  const route=url.endsWith('/device/code')?'device':url.endsWith('/access_token')?'token':'hosted';calls.push(route);
  return route===target?makeResponse(replies[route]):Response.json(replies[route]);
 }});
 return {saves,calls,run:async()=>{const started=await signIn.start();if(target==='device')return started;assert.equal(started.status,'started');clock=5000;return signIn.poll();}};
}
for(const route of ['device','token','hosted'])for(const declared of [true,false])for(const mode of ['settled','pending','throwing']){
 test(`${route} rejects oversized body (${declared?'declared':'streamed'}, ${mode})`,async()=>{
  let pulls=0,cancels=0,timer,body;
  const s=setup(route,data=>{const payload=JSON.stringify({...data,padding:'x'.repeat(limit)});
   body=new ReadableStream({pull(c){pulls++;if(pulls===1)c.enqueue(new TextEncoder().encode(payload));},cancel(){cancels++;if(mode==='pending')return new Promise(()=>{});if(mode==='throwing')throw new Error('cleanup');}},{highWaterMark:0});
   return new Response(body,{headers:declared?{'content-length':String(payload.length)}:{}});
  });
  try{
   const result=await Promise.race([s.run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cap blocked')),150);})]);
   assert.equal(result.status,route==='hosted'?'hosted_error':'github_error');assert.equal(cancels,1);assert.equal(pulls,declared?0:1);assert.equal(body.locked,false);assert.deepEqual(s.saves,[]);
   if(route==='token')assert.deepEqual(s.calls,['device','token']);
  }finally{clearTimeout(timer);}
 });
}
for(const route of ['device','token','hosted'])test(`${route} refuses unbounded json-only adapter`,async()=>{
 let reads=0;const s=setup(route,data=>({status:200,ok:true,json:async()=>{reads++;return data;}}));
 assert.equal((await s.run()).status,route==='hosted'?'hosted_error':'github_error');assert.equal(reads,0);assert.deepEqual(s.saves,[]);
});
test('exact-cap hosted JSON succeeds and saves only credentials',async()=>{
 const s=setup('hosted',data=>{const base=JSON.stringify({...data,padding:''});const rest=limit-Buffer.byteLength(base);const payload=JSON.stringify({...data,padding:'é'.repeat(Math.floor(rest/2))+'x'.repeat(rest%2)});assert.equal(Buffer.byteLength(payload),limit);return new Response(payload);});
 assert.equal((await s.run()).status,'signed_in');assert.deepEqual(s.saves,[{login:'fixture',deviceId:'fixture',token:'fixture',baseUrl:'https://cards.example'}]);
});
test('small hosted 429 retains rate_limited',async()=>{
 const s=setup('hosted',()=>Response.json({error:'limited'},{status:429}));assert.equal((await s.run()).status,'rate_limited');assert.deepEqual(s.saves,[]);
});
