import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
test('choosing another server clears stale missing-field validation',async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{attrs:{'aria-invalid':'true'},setAttribute(k,v){this.attrs[k]=v},focus(){},addEventListener(){}});return nodes.get(id)};
 const context={$:get,signInCommitting:false,flow:null,showAuthLink(){},stopFlow(){},label:{},say(){},returnFocus:null,selection:null};
 const start=SERVER_SCRIPT.indexOf('async function choose('),end=SERVER_SCRIPT.indexOf('async function finish(',start);
 runInNewContext(SERVER_SCRIPT.slice(start,end),context);await context.choose('emby','http://127.0.0.1:8096',get('manual-connect'));
 assert.equal(get('signin-username').attrs['aria-invalid'],'false');assert.equal(get('signin-password').attrs['aria-invalid'],'false');
});
