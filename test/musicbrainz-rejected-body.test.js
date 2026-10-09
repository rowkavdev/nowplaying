import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicBrainzLookup } from '../src/musicbrainz-lookup.js';
for(const status of [429,503])for(const mode of ['settled','pending','throwing']){
 test(`MusicBrainz ${status} quietly cancels rejected search body (${mode})`,async()=>{
  let cancelled=0,pulls=0,calls=0,timer;
  const body=new ReadableStream({pull(){pulls++;},cancel(){cancelled++;if(mode==='pending')return new Promise(()=>{});if(mode==='throwing')throw new Error('cleanup failed');}},{highWaterMark:0});
  const lookup=createMusicBrainzLookup({minIntervalMs:0,fetchImpl:async()=>{calls++;return new Response(body,{status});}});
  try{
   assert.equal(await Promise.race([lookup({title:'fixture',artist:'fixture'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cleanup blocked lookup')),100);})]),null);
   assert.equal(cancelled,1);assert.equal(pulls,0);assert.equal(calls,1);assert.equal(body.locked,false);
  }finally{clearTimeout(timer);}
 });
}
