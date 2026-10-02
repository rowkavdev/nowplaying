import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
test('Enter in Subnet to scan runs Find servers, ignoring composing and other keys',()=>{
 const nodes=new Map();let clicks=0,prevented=0;
 const get=id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(event,fn){this[event]=fn},click(){clicks++}});return nodes.get(id)};
 const start=SERVER_SCRIPT.indexOf("$('scan-subnet').addEventListener('keydown'");assert.ok(start>=0,'Subnet needs an Enter handler');
 const end=SERVER_SCRIPT.indexOf("$('discover-servers').addEventListener",start);runInNewContext(SERVER_SCRIPT.slice(start,end),{$:get});
 for(const event of [{key:'Tab'},{key:'Enter',isComposing:true},{key:'Enter'}])get('scan-subnet').keydown({...event,preventDefault(){prevented++}});
 assert.equal(clicks,1);assert.equal(prevented,1);
});
