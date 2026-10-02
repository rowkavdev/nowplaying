import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {SERVICE_SCRIPT} from "../src/settings-onboarding-page.js";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const outcome of ["signed_in","expired"]) test(`hosted sign-in ${outcome} preserves focus when its verification link is replaced`,async()=>{
 const fetches=[], timers=[], nodes=new Map();const document={activeElement:null,getElementById:id=>{if(!nodes.has(id))nodes.set(id,create(id));return nodes.get(id);},createElement:tag=>create(null)};
 function create(id){return {id,value:"https://cards.example",children:[],hidden:false,_text:"",get textContent(){return this._text;},set textContent(t){this._text=t;this.children=[];},setAttribute(k,v){this[k]=v},addEventListener(e,fn){this[e]=fn;},replaceChildren(...c){this.children=c;},contains(other){return this===other||this.children.some(c=>typeof c==='object'&&c.contains?.(other));},focus(){document.activeElement=this;}}}
 const node=document.getElementById;
 runInNewContext(SERVICE_SCRIPT,{document,fetch:(path,options)=>new Promise(resolve=>fetches.push({path,options,resolve:body=>resolve({ok:true,json:async()=>body})})),setTimeout:fn=>timers.push(fn),performance:{now:()=>0},window:{open(){}}});
 fetches[0].resolve({spotify:null,hosted:{url:"https://cards.example"}});await tick();
 const start=node("hosted-connect").click();fetches[1].resolve({status:"started",verificationUri:"https://github.com/login/device",userCode:"TEST",interval:5});await start;
 node("hosted-service-result").children[1].focus();const poll=timers.shift()();fetches[2].resolve({status:outcome,cardUrl:"https://cards.example/u/test.svg"});await tick();
 if(outcome==="signed_in"){fetches[3].resolve({spotify:null,hosted:{url:"https://cards.example",login:"test"}});await tick();}await poll;
 assert.equal(node("hosted-service-result").children.length,0);assert.equal(document.activeElement,node("hosted-connect"));
});
