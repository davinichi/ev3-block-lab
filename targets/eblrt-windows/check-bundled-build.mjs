import {runtimeConfig} from './runtime-config.mjs';
import {createBuildService} from './bridge/core.mjs';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const config=await runtimeConfig(root),service=createBuildService(config);
console.log('Private compiler:',config.compilerBin,'private shell:',config.bashPath);
const job=await service.start({name:'BundledSound',program:{main:[{type:'tone',frequency:440,ms:1000,volume:10}],procedures:[]},motorTypes:{}});
for(let i=0;i<150;i++){
 const status=service.jobs.get(job.id);
 if(status.status!=='building'){
  await writeFile(path.join(root,'bundled-build.log'),status.log);
  console.log(status.status,status.size,status.error??'');assert.equal(status.status,'success',status.log);break;
 }await new Promise(r=>setTimeout(r,1000));
}
