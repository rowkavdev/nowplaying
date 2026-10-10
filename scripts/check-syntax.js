import {readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';

// node --check accepts one file, not a shell-expanded list. Check each source
// separately, including nested hosted routes and scripts, without executing it.
const excluded=new Set(['.git','node_modules','dist','coverage','.next']);
function filesAt(dir){
 const files=[];
 for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  const file=join(dir,entry.name);
  if(entry.isDirectory()&&!excluded.has(entry.name))files.push(...filesAt(file));
  else if(entry.isFile()&&/\.(?:js|mjs|cjs)$/.test(entry.name))files.push(file);
 }
 return files;
}
let failed=false;
const files=filesAt(resolve(process.argv[2]??'.'));
for(const file of files){
 const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
 if(result.error||result.status!==0){
  failed=true;
  process.stderr.write(`Syntax check failed: ${file}\n`);
  process.stderr.write(result.stderr||String(result.error??`exit ${result.status}`)+'\n');
 }
}
console.log(`Checked ${files.length} JavaScript file${files.length===1?'':'s'}.`);
process.exitCode=failed?1:0;
