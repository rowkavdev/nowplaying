import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {findDesktopInstance} from "../src/desktop-instance.js";
const secret="a".repeat(64);

for(const mode of ["bad_status","bad_type","overflow"]){
  test(`instance ${mode} ignores stalled cancellation`,async()=>{
    let cancelled=0;const bodies=[];
    let calls=0;
    const pending=findDesktopInstance({port:47832,secret,attempts:2,fetchImpl:async()=>{
      calls++;
      const body=new ReadableStream({start(c){if(mode==="overflow")c.enqueue(new Uint8Array(1025));},cancel(){cancelled++;return new Promise(()=>{});}});
      bodies.push(body);
      return new Response(body,{status:mode==="bad_status"?403:200,headers:{"content-type":mode==="bad_type"?"text/html":"application/json"}});
    }});
    let timer;const result=await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(()=>resolve("hung"),150);})]);clearTimeout(timer);
    assert.equal(result,null);assert.equal(calls,2);assert.equal(cancelled,2);
    assert.ok(bodies.every(body=>!body.locked));
  });
}

test("valid identity proof releases its reader and still succeeds",async()=>{
  let body;
  const result=await findDesktopInstance({port:47832,secret,fetchImpl:async url=>{
    const challenge=new URL(url).searchParams.get("challenge");
    const proof=createHmac("sha256",secret).update(`nowplaying-desktop:${challenge}`).digest("hex");
    body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({app:"NowPlaying",proof})));c.close();}});
    return new Response(body,{headers:{"content-type":"application/json"}});
  }});
  assert.equal(result,"http://127.0.0.1:47832");assert.equal(body.locked,false);
});

for(const mode of ["throws","rejects"]){
 test(`failed cleanup ${mode} cannot change rejection or retry`,async()=>{
  let calls=0,released=0;
  const result=await findDesktopInstance({port:47832,secret,attempts:2,fetchImpl:async()=>{
   calls++;return {ok:true,headers:new Headers({"content-type":"application/json"}),body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(1025)}),cancel:()=>{if(mode==="throws")throw Error("cleanup");return Promise.reject(Error("cleanup"));},releaseLock:()=>{released++;throw Error("release");}})}};
  }});
  assert.equal(result,null);assert.equal(calls,2);assert.equal(released,2);
 });
}
