import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverLocalServers } from '../src/setup-discovery.js';
for (const scenario of ['stream overflow', 'declared overflow', 'success', 'read error']) for (const mode of ['settled', 'pending', 'throwing']) {
  test(`discovery ${scenario} releases body with ${mode} cleanup`, async () => {
    let cancelled=0; const failures=[];
    const body=new ReadableStream({
      start(c) {if (scenario==='success') {c.enqueue(new TextEncoder().encode('ok'));c.close();} else if(scenario==='read error') c.error(new Error('fixture read')); else if(scenario==='stream overflow')c.enqueue(new Uint8Array(65537));},
      cancel(){cancelled++;if(mode==='pending')return new Promise(()=>{});if(mode==='throwing')throw new Error('cleanup');},
    });
    let timer;
    try {
      const result=await Promise.race([
        discoverLocalServers({timeoutMs:1000,networkHosts:[],discoverLan:null,discoverPlex:null,probes:[{port:8096,path:'/fixture',classify:({text})=>text==='ok'?{provider:'jellyfin'}:null}],fetchImpl:async()=>new Response(body,{headers:scenario==='declared overflow'?{'content-length':'65537'}:{}}),onProbeFailure:failure=>failures.push(failure.reason)}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('discovery waited on cleanup')),100);}),
      ]);
      assert.equal(result.length,scenario==='success'?1:0);
      assert.equal(body.locked,false);
      if(scenario.endsWith('overflow')){assert.equal(cancelled,1);assert.deepEqual(failures,['oversize']);}
      if(scenario==='read error')assert.deepEqual(failures,['network_error']);
    } finally {clearTimeout(timer);}
  });
}
