import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createHttpServer } from '../src/http-server.js';
import { SERVER_SCRIPT } from '../src/settings-onboarding-page.js';

function requestFunction(fetchImpl) {
  const start=SERVER_SCRIPT.indexOf('async function request(');
  const end=SERVER_SCRIPT.indexOf('function serverAddress(',start);
  const context={fetch:fetchImpl};
  runInNewContext(SERVER_SCRIPT.slice(start,end)+';globalThis.request=request;',context);
  return context.request;
}

test('Jellyfin and Navidrome sign-in recover a cookie rotated by a server save',async (t)=>{
  let commits=0;
  const app=createHttpServer({port:0,sessionSecret:'b'.repeat(40),handler:async request=>{
    if(request.url==='/settings') return {status:200,page:true,headers:{'Content-Type':'text/html'},body:'Settings'};
    commits++;
    return {status:200,headers:{'Content-Type':'application/json'},body:JSON.stringify({status:JSON.parse(request.body).provider==='jellyfin'?'pending':'signed_in'})};
  }});
  const address=await app.listen(); t.after(()=>app.close());
  for(const provider of ['jellyfin','navidrome']) {
    let cookie='nowplaying_session='+'a'.repeat(40);
    const statuses=[];
    const request=requestFunction(async(path,options)=>{
      const response=await fetch(`http://127.0.0.1:${address.port}${path}`,{...options,headers:{...options.headers,Cookie:cookie}});
      statuses.push(response.status);
      const updated=response.headers.get('set-cookie');
      if(updated) cookie=updated.split(';')[0];
      return response;
    });
    const result=await request('/api/setup/signin','POST',{provider});
    assert.equal(result.status,provider==='jellyfin'?'pending':'signed_in');
    assert.deepEqual(statuses,[403,200,200]);
  }
  assert.equal(commits,2,'the rejected writes must never execute');
});

test('session recovery retries once and explains a persistent rejection',async()=>{
  const calls=[];
  const request=requestFunction(async path=>{calls.push(path);return path==='/settings'?{ok:true}:{ok:false,status:403,json:async()=>{throw Error('plain text')}};});
  await assert.rejects(request('/api/setup/signin','POST',{}),{message:'Your settings session expired. Reload this page and try again.'});
  assert.deepEqual(calls,['/api/setup/signin','/settings','/api/setup/signin']);
});

test('authentication errors are not retried',async()=>{
  let calls=0;
  const request=requestFunction(async()=>{calls++;return {ok:false,status:400,json:async()=>({error:'authentication_failed'})};});
  await assert.rejects(request('/api/setup/signin','POST',{}),{message:"That username or password didn't work."});
  assert.equal(calls,1);
});
