import {fileURLToPath} from "node:url";
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const checker=new URL('../scripts/check-syntax.js',import.meta.url);
test('syntax checker rejects a bad second file, including nested files and spaces',async()=>{
 const root=await mkdtemp(join(tmpdir(),'syntax checker '));
 try{
  await mkdir(join(root,'nested'));
  await writeFile(join(root,'a.mjs'),'export const ok = true;');
  await writeFile(join(root,'nested','b file.mjs'),'export const broken = ;');
  const result=spawnSync(process.execPath,[fileURLToPath(checker),root],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/b file\.mjs/);assert.match(result.stderr,/SyntaxError/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('syntax checker accepts valid files and does not check dependencies/build output',async()=>{
 const root=await mkdtemp(join(tmpdir(),'syntax checker '));
 try{
  await writeFile(join(root,'a.cjs'),'module.exports = true;');
  for(const dir of ['node_modules','.git','dist']){await mkdir(join(root,dir));await writeFile(join(root,dir,'broken.js'),'const = ;');}
  const result=spawnSync(process.execPath,[fileURLToPath(checker),root],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Checked 1 JavaScript file/);
 }finally{await rm(root,{recursive:true,force:true});}
});
