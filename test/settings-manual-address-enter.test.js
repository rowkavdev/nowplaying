import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {SERVER_SCRIPT} from '../src/settings-onboarding-page.js';
test('Enter in the manual server address invokes Connect through its existing validation path',()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,hidden:false,listeners:{},addEventListener(e,f){this.listeners[e]=f},setAttribute(k,v){this[k]=v},replaceChildren(){},focus(){},click(){return this.listeners.click({currentTarget:this})}});return nodes.get(id)};let chosen=0,trigger;
 const start=SERVER_SCRIPT.indexOf("$('manual-connect').addEventListener"),end=SERVER_SCRIPT.indexOf("$('signin-cancel').addEventListener",start);
 runInNewContext(SERVER_SCRIPT.slice(start,end),{$:get,URL,choose(provider,url,button){chosen++;trigger=button},say(){}});
 get('server-url').value='http://192.168.1.2:4533';let prevented=false;get('server-url').listeners.keydown?.({key:'Enter',preventDefault(){prevented=true}});assert.equal(chosen,1);assert.equal(trigger,get('manual-connect'));assert.equal(prevented,true);
 get('server-url').value='bad address';get('server-url').listeners.keydown({key:'Enter',preventDefault(){}});assert.equal(chosen,1);assert.equal(get('server-url')['aria-invalid'],'true');
 get('server-url').listeners.keydown({key:'Enter',isComposing:true,preventDefault(){throw Error('composition')}});assert.equal(chosen,1);
});
