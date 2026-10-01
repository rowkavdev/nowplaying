import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createLogsPageHandler} from '../src/logs-page-handler.js';
test('copy feedback does not hide a lost Logs connection',async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='level'?'info':'',hidden:false,textContent:'',listeners:{},addEventListener(e,fn){this.listeners[e]=fn},replaceChildren(){},appendChild(){}});return nodes.get(id)};
 const h=createLogsPageHandler({readEvents:async()=>[],fallback:async()=>null});let reload,online=false;
 runInNewContext((await h({url:'/logs.js'})).body,{document:{getElementById:get,querySelector:()=>get('tbody'),createElement:()=>({appendChild(){}})},Date,fetch:async()=>{if(!online)throw Error();return {ok:true,json:async()=>({events:[]})}},setInterval(fn){reload=fn},navigator:{clipboard:{writeText:async()=>{}}}});
 await new Promise(r=>setImmediate(r));await get('copy-log').listeners.click();
 assert.match(get('log-result').textContent,/Copied/);
 assert.equal(get('log-error').hidden,false);assert.match(get('log-error').textContent,/out of date/);
 online=true;await reload();assert.equal(get('log-error').hidden,true);
});
