import test from 'node:test';
import assert from 'node:assert/strict';
import { startPlexPin, startJellyfinQuickConnect, signInEmby, signInNavidrome } from '../src/provider-signin.js';
const flows = [
 ['plex', fetchImpl => startPlexPin({clientId:'fixture',fetchImpl})],
 ['jellyfin', fetchImpl => startJellyfinQuickConnect({baseUrl:'https://server.example',deviceId:'fixture',fetchImpl})],
 ['emby', fetchImpl => signInEmby({baseUrl:'https://server.example',deviceId:'fixture',username:'u',password:'p',fetchImpl})],
 ['navidrome', fetchImpl => signInNavidrome({baseUrl:'https://server.example',username:'u',password:'p',salt:'fixture',fetchImpl})],
];
for (const [provider, run] of flows) for (const status of [401,403,503]) for (const mode of ['settled','pending','throwing']) {
 test(`${provider} ${status} cancels unread sign-in body (${mode})`, async () => {
  let cancelled=0,pulls=0;
  const body=new ReadableStream({pull(){pulls++;},cancel(){cancelled++;if(mode==='pending')return new Promise(()=>{});if(mode==='throwing')throw new Error('cleanup failed');}},{highWaterMark:0});
  let timer;
  try {
   await assert.rejects(Promise.race([run(async()=>new Response(body,{status})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cleanup blocked rejection')),100);})]),error=>error.status===(status===503?'connection_failed':provider==='jellyfin'?'quick_connect_disabled':'authentication_failed'));
   assert.equal(cancelled,1);assert.equal(pulls,0);assert.equal(body.locked,false);
  } finally {clearTimeout(timer);}
 });
}
