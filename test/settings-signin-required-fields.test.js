import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
for(const codeOnly of [false,true])for(const error of ['username_required','password_required','unreachable'])test(`server sign-in marks only the missing field for ${error} (${codeOnly?'readable message':'raw message'})`,async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',attrs:{},addEventListener(e,f){this[e]=f},setAttribute(k,v){this.attrs[k]=v}});return nodes.get(id)};
 const context={$:get,selection:{provider:'navidrome',baseUrl:'http://127.0.0.1:4533'},signInAttempt:0,request:async()=>{throw codeOnly?Object.assign(Error("Readable field error"),{code:error}):Error(error)},say(){}};const start=SERVER_SCRIPT.indexOf("$('signin-button').addEventListener"),end=SERVER_SCRIPT.indexOf('load();',start);runInNewContext(SERVER_SCRIPT.slice(start,end),context);await get('signin-button').click();
 for(const key of ['username','password'])assert.equal(get('signin-'+key).attrs['aria-invalid'],String(error===key+'_required'));
 context.request=async()=>{throw Error('unreachable')};await get('signin-button').click();for(const key of ['username','password'])assert.equal(get('signin-'+key).attrs['aria-invalid'],'false');
});
