import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVICE_SCRIPT} from '../src/settings-onboarding-page.js';
test('Enter in the Spotify Client ID field starts sign-in, but composing and other keys do not',()=>{
 const nodes=new Map();let clicks=0,prevented=0;
 const get=id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(event,fn){this[event]=fn},click(){clicks++}});return nodes.get(id)};
 const start=SERVICE_SCRIPT.indexOf("$('spotify-client-id').addEventListener('keydown'");assert.ok(start>=0,'Client ID needs an Enter handler');
 const end=SERVICE_SCRIPT.indexOf("$('spotify-connect').addEventListener",start);runInNewContext(SERVICE_SCRIPT.slice(start,end),{$:get});
 for(const event of [{key:'Tab'},{key:'Enter',isComposing:true},{key:'Enter'}])get('spotify-client-id').keydown({...event,preventDefault(){prevented++}});
 assert.equal(clicks,1);assert.equal(prevented,1);
});
