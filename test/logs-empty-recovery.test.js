import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createLogsPageHandler } from '../src/logs-page-handler.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
test('Logs distinguishes filtered empty states and clears stale connection errors on recovery', async () => {
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='level'?'info':'',hidden:false,textContent:'',listeners:{},addEventListener(event,fn){this.listeners[event]=fn;},replaceChildren(){},appendChild(){}});return nodes.get(id);};
  let failed=true, reload;
  const handler=createLogsPageHandler({readEvents:async()=>[],fallback:async()=>null});
  runInNewContext((await handler({url:'/logs.js'})).body, {
    document:{getElementById:get,querySelector:()=>get('tbody'),createElement:()=>({appendChild(){}})},Date,
    fetch:async()=>{if(failed)throw Error();return {ok:true,json:async()=>({events:[{time:'2026-10-01',level:'info',component:'startup',status:'ready'}]})};},
    setInterval(fn){reload=fn;},navigator:{clipboard:{writeText:async()=>{}}},
  });
  await tick();assert.match(get('log-error').textContent,/out of date/);
  failed=false;await reload();assert.equal(get('log-error').hidden,true);
  get('level').value='error';get('level').listeners.change();assert.equal(get('log-empty').textContent,'No errors in recent events.');
  get('level').value='warn';get('level').listeners.change();assert.equal(get('log-empty').textContent,'No warnings or errors in recent events.');
});
