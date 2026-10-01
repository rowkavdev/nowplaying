import test from 'node:test';
import assert from 'node:assert/strict';
import {createLogsPageHandler} from '../src/logs-page-handler.js';
test('the Logs table scroll region is keyboard focusable and named',async()=>{
 const h=createLogsPageHandler({readEvents:async()=>[],fallback:async()=>null});
 const page=(await h({url:'/logs'})).body;
 assert.match(page,/class="log-table" tabindex="0" role="region" aria-label="Recent log events"/);
});
