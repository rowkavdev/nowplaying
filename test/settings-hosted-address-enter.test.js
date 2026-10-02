import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVICE_SCRIPT} from '../src/settings-onboarding-page.js';
test('Enter in Card service address checks the service, without starting sign-in',()=>{
 const nodes=new Map();let checks=0,signins=0,prevented=0;
 const get=id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(event,fn){this[event]=fn},click(){if(id==='hosted-check')checks++;if(id==='hosted-connect')signins++}});return nodes.get(id)};
 const start=SERVICE_SCRIPT.indexOf("$('hosted-address').addEventListener('keydown'");assert.ok(start>=0,'Card service address needs an Enter handler');
 const end=SERVICE_SCRIPT.indexOf("$('hosted-check').addEventListener",start);runInNewContext(SERVICE_SCRIPT.slice(start,end),{$:get});
 for(const event of [{key:'Tab'},{key:'Enter',isComposing:true},{key:'Enter'}])get('hosted-address').keydown({...event,preventDefault(){prevented++}});
 assert.equal(checks,1);assert.equal(signins,0);assert.equal(prevented,1);
});
