import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {SERVICE_SCRIPT} from "../src/settings-onboarding-page.js";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for (const outcome of ["signed_in","failed"]) test(`Spotify sign-in ${outcome} returns focus before removing its link`,async()=>{
 const fetches=[], nodes=new Map();const document={activeElement:null,getElementById:id=>{if(!nodes.has(id))nodes.set(id,create(id));return nodes.get(id);},createElement:tag=>create(null)};
 function create(id){return {id,value:"id",children:[],hidden:false,textContent:"",setAttribute(k,v){this[k]=v},addEventListener(e,fn){this[e]=fn;},replaceChildren(...c){this.children=c;},contains(other){return this===other||this.children.some(c=>c.contains?.(other));},focus(){document.activeElement=this;}}}
 const node=document.getElementById;
 runInNewContext(SERVICE_SCRIPT,{document,fetch:(path,options)=>new Promise(resolve=>fetches.push({path,options,resolve:body=>resolve({ok:true,json:async()=>body})})),setTimeout:()=>1,window:{open(){}}});
 fetches[0].resolve({spotify:null,hosted:{url:"https://cards.example"}});await tick();
 const start=node("spotify-connect").click();fetches[1].resolve({flowId:"test",authUrl:"https://accounts.spotify.com/authorize"});await start;
 node("spotify-open-link").children[0].focus();fetches[2].resolve({status:outcome});await tick();
 if(outcome==="signed_in"){fetches[3].resolve({spotify:{name:"Test",clientId:"id"},hosted:{url:"https://cards.example"}});await tick();}
 assert.equal(node("spotify-open-link").hidden,true);assert.equal(document.activeElement,node("spotify-connect"));
});
