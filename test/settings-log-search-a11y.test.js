import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('invalid Settings log search identifies its error on the focused input and clears on recovery',async()=>{
 const handler=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const html=(await handler({url:'/settings'})).body;
 assert.match(html,/<input[^>]*id="drpp-search"[^>]*aria-describedby="drpp-log-error"/);
 const script=(await handler({url:'/settings.js'})).body;const start=script.indexOf('const lines = document.getElementById("drpp-log-lines")');const end=script.indexOf('// DRPP AutostartSwitch:',start);
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,hidden:false,textContent:'',attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},addEventListener(e,f){this[e]=f;},replaceChildren(){}});return nodes.get(id);};
 runInNewContext(script.slice(start,end),{document:{getElementById:get,createElement:()=>({append(){}})},localStorage:{getItem:()=>null}});
 const search=get('drpp-search');search.value='[';search.input();assert.equal(search.attrs['aria-invalid'],'true');assert.equal(get('drpp-log-error').hidden,false);
 search.value='provider';search.input();assert.equal(search.attrs['aria-invalid'],undefined);assert.equal(get('drpp-log-error').hidden,true);
});
