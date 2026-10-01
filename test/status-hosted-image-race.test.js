import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createStatusPageHandler} from '../src/status-page-handler.js';
test('a late hosted image load cannot revive an off or replaced preview',async()=>{
 const h=createStatusPageHandler({status:{snapshot(){},async refresh(){}},fallback:async()=>null});
 const script=(await h({url:'/status.js'})).body;const start=script.indexOf('function publicCardUrl(');const end=script.indexOf('const SERVER_ROW_WORDS',start);
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{src:'',hidden:false,textContent:'',removeAttribute(name){this[name]='';}});return nodes.get(id);};
 const ctx={document:{getElementById:get},URL,Date,cardTick:0,hostedPreviewUrl:null,location:{origin:'http://127.0.0.1:47832'}};
 runInNewContext(script.slice(start,end)+';globalThis.show=showCards;',ctx);
 ctx.show({enabled:true,state:'connected',cardUrl:'https://nowplaying-hosted.vercel.app/u/rowkav09.svg'});
 const staleLoad=get('hosted-card').onload;const staleError=get('hosted-card').onerror;
 ctx.show({enabled:false,state:'off'});staleLoad();assert.equal(get('hosted-card').hidden,true);assert.match(get('hosted-card-note').textContent,/off/);
 ctx.show({enabled:true,state:'connected',cardUrl:'https://nowplaying-hosted.vercel.app/u/other.svg'});staleError();assert.equal(get('hosted-card').hidden,false);
});
