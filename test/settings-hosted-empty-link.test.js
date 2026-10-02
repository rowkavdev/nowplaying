import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('waiting for a hosted URL is text, not a false same-page link, and the first URL restores the link',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const script=(await h({url:'/settings.js'})).body,start=script.indexOf('function showHosted(h)'),end=script.indexOf('async function copy(',start);const nodes=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{id,attrs:{},textContent:'',set href(v){this.attrs.href=v},get href(){return this.attrs.href},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},contains(){return false}});return nodes.get(id)};
 const ctx={document:{getElementById:get},hosted:{form:{},enabled:{},save:{}},HOSTED_WORDS:{idle:['Waiting',''],connected:['Connected','']},hostedLink:url=>url};runInNewContext(script.slice(start,end)+';globalThis.show=showHosted',ctx);
 ctx.show({enabled:true,state:'idle'});assert.equal(get('hosted-url').href,undefined);assert.equal(get('hosted-url').textContent,'Appears after the first upload');ctx.show({enabled:true,state:'connected',cardUrl:'https://cards.example/card.svg'});assert.equal(get('hosted-url').href,'https://cards.example/card.svg');ctx.show({enabled:true,state:'idle'});assert.equal(get('hosted-url').href,undefined);
});
