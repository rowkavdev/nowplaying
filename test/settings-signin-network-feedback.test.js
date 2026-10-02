import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
const messages={unreachable:"Couldn't reach that server. Check the address and that the server is running.",name_not_found:"Couldn't find a server with that name. Check the spelling, or use the server's IP address.",tls_untrusted:"This server's security certificate isn't trusted. Use a certificate this computer trusts, or the server's local http:// address.",timed_out:"That server took too long to answer. Check the address and that the server is running."};
for(const [error,message] of Object.entries(messages))test(`server sign-in ${error} gives readable repair steps`,async()=>{
 const start=SERVER_SCRIPT.indexOf('async function request('),end=SERVER_SCRIPT.indexOf('async function load()',start);const context={fetch:async()=>({ok:false,json:async()=>({error})})};runInNewContext(SERVER_SCRIPT.slice(start,end)+';globalThis.request=request;',context);await assert.rejects(context.request('/api/setup/signin','POST',{}),{message});
});
