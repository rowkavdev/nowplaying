import test from 'node:test';
import assert from 'node:assert/strict';
import {checkForUpdate} from '../src/update-check.js';
for(const status of [401,429,503])for(const mode of ['settled','pending','throwing']){
 test(`update check ${status} cancels unread body (${mode})`,async()=>{
  let cancels=0,pulls=0,timer;
  const body=new ReadableStream({pull(){pulls++;},cancel(){cancels++;if(mode==='pending')return new Promise(()=>{});if(mode==='throwing')throw new Error('cleanup');}},{highWaterMark:0});
  try{
   await assert.rejects(Promise.race([checkForUpdate({currentVersion:'0.2.0',repository:'rowkavdev/nowplaying',fetchImpl:async()=>new Response(body,{status})}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cleanup blocked')),100);})]),{message:`update check failed (${status})`});
   assert.equal(cancels,1);assert.equal(pulls,0);assert.equal(body.locked,false);
  }finally{clearTimeout(timer);}
 });
}
test('bodyless rejected update adapter preserves status error',async()=>{
 await assert.rejects(checkForUpdate({currentVersion:'0.2.0',repository:'rowkavdev/nowplaying',fetchImpl:async()=>({ok:false,status:503})}),{message:'update check failed (503)'});
});
