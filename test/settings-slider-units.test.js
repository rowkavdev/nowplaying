import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('padding, corners and bar thickness expose their pixel units',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});
 const script=(await h({url:'/settings.js'})).body,start=script.indexOf('function cardChanged()'),end=script.indexOf('function showCard(',start);
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'100',checked:true,textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;}});return nodes.get(id);};
 const auto={artworkWidth:true,artworkHeight:true};const ctx={document:{getElementById:get},cardField:key=>get('card-'+key),ART_AUTO:auto,card:{scaleNote:{}},previewGeneration:0,previewTimer:null,previewRequest:null,setTimeout:()=>1,clearTimeout(){}};
 runInNewContext(script.slice(start,end)+';globalThis.changed=cardChanged;',ctx);
 ctx.changed();for(const key of ['padding','radius','progressHeight'])assert.equal(get('card-'+key).attrs['aria-valuetext'],'100 px');
 get('card-padding').value='24';get('card-radius').value='10';get('card-progressHeight').value='4';ctx.changed();
 for(const [key,value] of [['padding','24 px'],['radius','10 px'],['progressHeight','4 px']])assert.equal(get('card-'+key).attrs['aria-valuetext'],value);
});
