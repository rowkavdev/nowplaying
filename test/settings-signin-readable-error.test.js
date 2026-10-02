import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
test('server authentication failure gives a readable username/password error instead of an API code',async()=>{
 const start=SERVER_SCRIPT.indexOf('async function request('),end=SERVER_SCRIPT.indexOf('async function load()',start);
 const context={fetch:async()=>({ok:false,json:async()=>({error:'authentication_failed'})})};runInNewContext(SERVER_SCRIPT.slice(start,end)+';globalThis.request=request;',context);
 await assert.rejects(context.request('/api/setup/signin','POST',{}),{message:"That username or password didn't work."});
});
