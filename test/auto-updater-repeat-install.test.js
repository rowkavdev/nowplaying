import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createAutoUpdater} from '../src/auto-updater.js';

test('sequential API checks do not reinstall or replace the original rollback backup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'updater-repeat-'));
 try{
  const target=join(root,'app'),stage=join(root,'stage');
  await mkdir(target);await writeFile(join(target,'original'),'old');
  await mkdir(join(stage,'dist'),{recursive:true});await writeFile(join(stage,'dist','manifest.json'),'{"version":"0.3.0"}');
  execFileSync('tar',['-czf',join(root,'update.tar.gz'),'-C',stage,'.']);
  const bytes=await readFile(join(root,'update.tar.gz'));const hash=createHash('sha256').update(bytes).digest('hex');
  let downloads=0,notifications=0;
  const updater=createAutoUpdater({currentVersion:'0.2.0',repository:'o/r',channel:'stable',platform:'linux',mode:'install',targetDir:target,onUpdate:async()=>{notifications++;},fetchImpl:async url=>{
   if(url.endsWith('/releases'))return Response.json([{tag_name:'v0.3.0',assets:[{name:'nowplaying-v0.3.0.tar.gz',url:'https://api.github.com/asset'},{name:'SHA256SUMS',url:'https://api.github.com/sums'}]}]);
   if(url.endsWith('/sums'))return new Response(hash+'  nowplaying-v0.3.0.tar.gz');
   downloads++;return new Response(bytes);
  }});
  const first=await updater.check();assert.equal(first.status,'installed');assert.equal(first.restartRequired,true);
  assert.deepEqual(await updater.check(),first);
  assert.equal(downloads,1);assert.equal(notifications,1);
  assert.equal(await readFile(join(target+'.backup','original'),'utf8'),'old');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('notify mode continues checking against the running version',async()=>{
 let checks=0,notifications=0;
 const updater=createAutoUpdater({currentVersion:'0.2.0',repository:'o/r',channel:'stable',platform:'linux',mode:'notify',onUpdate:async()=>{notifications++;},fetchImpl:async()=>{checks++;return Response.json([{tag_name:'v0.3.0',assets:[{name:'nowplaying-v0.3.0.tar.gz',url:'https://api.github.com/asset'},{name:'SHA256SUMS',url:'https://api.github.com/sums'}]}]);}});
 for(let i=0;i<2;i++){const result=await updater.check();assert.equal(result.status,'available');assert.equal(result.currentVersion,'0.2.0');}
 assert.equal(checks,2);assert.equal(notifications,2);
});
