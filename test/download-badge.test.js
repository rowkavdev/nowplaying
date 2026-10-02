import test from 'node:test';
import assert from 'node:assert/strict';
import {createDownloadBadgeHandler} from '../src/download-badge.js';
const ok=()=>createDownloadBadgeHandler({readReleaseDownloads:async tag=>tag==='v1.0.0'?42:0});
test('requires a reader function',()=>{assert.throws(()=>createDownloadBadgeHandler({}),TypeError);});
test('returns a shields endpoint body for a valid tag',async()=>{
 const r=await ok()({method:'GET',url:'/badges/downloads/v1.0.0.json'});
 assert.equal(r.status,200);assert.deepEqual(JSON.parse(r.body),{schemaVersion:1,label:'v1.0.0 downloads',message:'42',color:'#58a6ff'});
 assert.equal(r.headers['Cache-Control'],'public, max-age=300');
});
test('HEAD returns headers with no body',async()=>{
 const r=await ok()({method:'HEAD',url:'/badges/downloads/v1.0.0.json'});assert.equal(r.status,200);assert.equal(r.body,'');
});
test('other methods get 405 with Allow',async()=>{
 const r=await ok()({method:'POST',url:'/badges/downloads/v1.0.0.json'});assert.equal(r.status,405);assert.equal(r.headers.Allow,'GET, HEAD');
});
test('unknown paths and bad tags get 404 without calling the reader',async()=>{
 let calls=0;const h=createDownloadBadgeHandler({readReleaseDownloads:async()=>{calls++;return 1}});
 for(const url of ['/other','/badges/downloads/.json','/badges/downloads/a%20b.json','/badges/downloads/'+'a'.repeat(129)+'.json'])assert.equal((await h({method:'GET',url})).status,404,url);
 assert.equal(calls,0);
});
test('reader failures and invalid counts give a 503 unavailable badge that is not cached',async()=>{
 for(const read of [async()=>{throw Error('x')},async()=>-1,async()=>1.5,async()=>'3']){
  const r=await createDownloadBadgeHandler({readReleaseDownloads:read})({method:'GET',url:'/badges/downloads/v1.json'});
  assert.equal(r.status,503);assert.equal(JSON.parse(r.body).message,'unavailable');assert.equal(r.headers['Cache-Control'],'no-store');
 }
});
