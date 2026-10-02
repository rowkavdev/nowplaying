import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createSettingsPageHandler} from '../src/settings-page-handler.js';
test('YouTube Show and Copy remain disabled until there is a real pairing code',async()=>{
 const h=createSettingsPageHandler({settings:{read:()=>({discord:{}}),updateDiscord:async()=>{}},fallback:async()=>null});const page=(await h({url:'/settings'})).body;assert.match(page,/id="youtube-show" disabled/);assert.match(page,/id="youtube-copy" disabled/);const script=(await h({url:'/settings.js'})).body,start=script.indexOf('function youtubeRender()'),end=script.indexOf('async function youtubeFetch(',start);const copy={};const ctx={youtube:{code:{},show:{setAttribute(){}},token:'',shown:false},document:{getElementById:()=>copy}};runInNewContext(script.slice(start,end)+';globalThis.render=youtubeRender',ctx);ctx.render();assert.equal(ctx.youtube.show.disabled,true);assert.equal(copy.disabled,true);ctx.youtube.token='fixture-code';ctx.render();assert.equal(ctx.youtube.show.disabled,false);assert.equal(copy.disabled,false);
});
