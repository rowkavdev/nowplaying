import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
for(const loaded of [false,true])test(`failed server list fetch ${loaded?'preserves cached rows':'clears the loading placeholder'}`,async()=>{
 const list={textContent:loaded?'Plex - Example - http://server':'Loading...',replaceChildren(...children){this.textContent=children[0].textContent}};const output={textContent:''};const start=SERVER_SCRIPT.indexOf('async function load()'),end=SERVER_SCRIPT.indexOf('let activating=',start);const ctx={$:id=>id==='servers-list'?list:output,request:async()=>{throw Error('offline')},say:(id,text)=>output.textContent=text,li:text=>({textContent:text}),serverListLoaded:loaded};runInNewContext(SERVER_SCRIPT.slice(start,end)+';globalThis.loadServers=load',ctx);await ctx.loadServers();assert.equal(list.textContent,loaded?'Plex - Example - http://server':'Server list unavailable.');assert.match(output.textContent,/Could not load servers/);
});
