import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiscordClient} from '../src/discord-client.js';
for(const activity of [null,{details:'fixture'}])for(const succeeds of [true,false]){
 test(`close wins pending connect (${activity===null?'clear':'publish'}, ${succeeds?'resolve':'reject'})`,async()=>{
  let release,reject,writes=0;
  const transport={connect:()=>new Promise((yes,no)=>{release=yes;reject=no;}),clearActivity:async()=>writes++,setActivity:async()=>writes++,close:async()=>{}};
  const client=createDiscordClient({transport,minUpdateIntervalMs:0});
  const pending=client.publish(activity);await client.close();const closed=client.status();
  if(succeeds)release();else reject(new Error('fixture'));
  assert.equal(await pending,false);assert.equal(writes,0);assert.equal(client.connected,false);assert.deepEqual(client.status(),closed);
 });
}
for(const activity of [null,{details:'fixture'}])for(const succeeds of [true,false]){
 test(`close wins pending write (${activity===null?'clear':'publish'}, ${succeeds?'resolve':'reject'})`,async()=>{
  let release,reject,entered;
  const gate=new Promise(r=>entered=r);
  const write=()=>{entered();return new Promise((yes,no)=>{release=yes;reject=no;});};
  const transport={connect:async()=>{},clearActivity:write,setActivity:write,close:async()=>{}};
  const client=createDiscordClient({transport,minUpdateIntervalMs:0});
  const pending=client.publish(activity);await gate;await client.close();const closed=client.status();
  if(succeeds)release();else reject(new Error('fixture'));
  assert.equal(await pending,false);assert.equal(client.connected,false);assert.deepEqual(client.status(),closed);
 });
}
