import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {SERVICE_SCRIPT} from "../src/settings-onboarding-page.js";
const tick = () => new Promise(resolve => setImmediate(resolve));
function page() {
  const elements=new Map(), fetches=[];
  const document={activeElement:null,getElementById:id=>{if(!elements.has(id)) elements.set(id,{id,value:"",hidden:false,textContent:"",addEventListener(event,fn){this[event]=fn;},focus(){document.activeElement=this;}});return elements.get(id);}};
  runInNewContext(SERVICE_SCRIPT,{document,fetch:(path,options)=>new Promise(resolve=>fetches.push({path,options,resolve:body=>resolve({ok:true,json:async()=>body})})),confirm:()=>true,setTimeout:()=>1,window:{open(){}}});
  return {document,fetches,node:document.getElementById};
}
for(const moved of [false,true]) test(`Spotify disconnect ${moved ? "preserves other focus" : "returns focus before hiding the action"}`,async()=>{
  const {document,fetches,node}=page();fetches[0].resolve({spotify:{name:"Test",clientId:"id"},hosted:{url:"https://cards.example"}});await tick();
  node("spotify-remove").focus();const removal=node("spotify-remove").click();fetches[1].resolve({tokenRemoved:true});await tick();
  if(moved)node("hosted-address").focus();fetches[2].resolve({spotify:null,hosted:{url:"https://cards.example"}});await removal;
  assert.equal(node("spotify-remove").hidden,true);assert.equal(document.activeElement,node(moved ? "hosted-address" : "spotify-connect"));assert.match(node("spotify-service-result").textContent,/disconnected/);
});
