import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
for(const [error,message] of [['username_required','Enter your server username.'],['password_required','Enter your server password.']])test(`server sign-in ${error} gives a readable missing-field instruction`,async()=>{
 const start=SERVER_SCRIPT.indexOf('async function request('),end=SERVER_SCRIPT.indexOf('async function load()',start);const context={fetch:async()=>({ok:false,json:async()=>({error})})};runInNewContext(SERVER_SCRIPT.slice(start,end)+';globalThis.request=request;',context);await assert.rejects(context.request('/api/setup/signin','POST',{}),{message,code:error});
});
