import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('the setup notice opens Media servers and focuses its first field',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const script=(await h({url:'/settings.js'})).body;
 const start=script.indexOf('// Setup notice navigation'),end=script.indexOf('// DRPP InfoModal',start);assert.ok(start>=0&&end>start);
 let click,focused=false,prevented=false;const accordion={open:false};
 runInNewContext(script.slice(start,end),{document:{getElementById(id){return id==='drpp-setup-action'?{addEventListener(_,fn){click=fn}}:id==='servers-section'?{closest:()=>accordion}:{focus(){focused=true}}}}});
 click({preventDefault(){prevented=true}});assert.equal(accordion.open,true);assert.equal(focused,true);assert.equal(prevented,true);
});
