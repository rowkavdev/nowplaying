import test from 'node:test';
import assert from 'node:assert/strict';
import {createStatusPageHandler} from '../src/status-page-handler.js';
test('Status "All servers" rows wrap long unbroken user names instead of widening the page',async()=>{const h=createStatusPageHandler({status:{snapshot(){},async refresh(){}},fallback:async()=>null});assert.match((await h({url:'/status-ui.css'})).body,/\.status-ui #servers li\{[^}]*overflow-wrap:anywhere/)});
