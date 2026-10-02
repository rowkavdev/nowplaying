import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
const messages={quick_connect_disabled:'Quick Connect is turned off on this Jellyfin server. Turn it on in the Jellyfin dashboard and try again.',expired:'That sign-in expired. Start again.',too_many_signins:'Too many sign-ins are open. Wait a minute and try again.'};
for(const [error,message] of Object.entries(messages))test(`server sign-in ${error} gives a readable next step`,async()=>{
 const start=SERVER_SCRIPT.indexOf('async function request('),end=SERVER_SCRIPT.indexOf('async function load()',start);const context={fetch:async()=>({ok:false,json:async()=>({error})})};runInNewContext(SERVER_SCRIPT.slice(start,end)+';globalThis.request=request;',context);await assert.rejects(context.request('/api/setup/signin','POST',{}),{message});
});
