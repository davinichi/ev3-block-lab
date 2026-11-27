import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {myBlockParameterNames,myBlockFunctionNames} from '../dist/ev3rt-identifiers.js';
import {exportEV3RT} from '../dist/ev3rt.js';
import {compile} from '../dist/ev3.js';
import {splitRuntimeC} from '../dist/ev3rt-c-modules.js';

test('valid learner parameter names survive across signatures, references, and comments without mutating IR/RBF',()=>{
 const p={main:[{type:'call',name:'forward',args:[20,50]}],procedures:[{name:'forward',params:['speed','distance'],body:[{type:'wait',ms:{param:'distance'}}]}]};
 const before=JSON.stringify(p),rbf=compile(p).data,b=exportEV3RT(p,{name:'Names'});
 for(const file of ['ebl_myblocks.c','ebl_myblocks.h'])assert.match(b.files['Names/'+file],/forward\(float speed, float distance\)/);
 assert.match(b.files['Names/app.c'],/= forward\(/);
 const c=b.files['Names/ebl_myblocks.c'];assert.match(c,/lab_number\(distance\)/);assert.match(c,/引数「speed」 → speed/);
 assert.doesNotMatch(c,/lab_arg_0|lab_arg_1/);assert.equal(JSON.stringify(p),before);assert.deepEqual(compile(p).data,rbf);
 assert.deepEqual(myBlockParameterNames(['speed','Speed','distance_cm']),['speed','Speed','distance_cm']);
});
test('invalid, reserved, generated, SDK and macro-like names fall back without syntax injection or collisions',()=>{
 for(const n of ['int','float','lab_tmp_0','lab_arg_1','ev3_motor_set_power','get_tid','sin','fmaxf','bool','errno','stdin','stdout','stderr','asm','NULL','NAN','SPEED','uint32_t','_hidden','1speed','speed value','速度','x); /*','x'.repeat(64)]){
  assert.deepEqual(myBlockParameterNames([n,'distance']),['lab_arg_0','distance'],n);
 }
 assert.deepEqual(myBlockParameterNames(['speed','speed','lab_arg_1']),['speed','lab_arg_1','lab_arg_2']);
 const n='x); /*';const b=exportEV3RT({main:[{type:'call',name:'p',args:[2]}],procedures:[{name:'p',params:[n],body:[{type:'wait',ms:{param:n}}]}]});
 assert.match(b.files['EV3Lab/ebl_myblocks.c'],/p\(float lab_arg_0\)/);
 assert.match(b.files['EV3Lab/ebl_myblocks.c'],/Cで安全に使える名前へ変換/);
});
const gcc=process.platform==='win32'?'C:/cygwin64/bin/gcc.exe':'gcc';
const env={...process.env};if(process.platform==='win32'){const k=Object.keys(env).find(k=>k.toLowerCase()==='path')??'PATH';env[k]='C:\\cygwin64\\bin;'+env[k];}
const available=spawnSync(gcc,['--version'],{env,encoding:'utf8'}).status===0;
test('independent C modules compile and nested calls preserve values with repeated parameter names and reserved fallbacks',{skip:!available},()=>{
 const p={main:[{type:'wait',ms:1}],procedures:[
  {name:'outer',params:['speed','distance'],returns:true,results:[{callValue:{name:'inner',args:[{param:'distance'},{param:'speed'}]}}],body:[]},
  {name:'inner',params:['outer','int'],returns:true,results:[{op:'sub',left:{param:'outer'},right:{param:'int'}}],body:[]}
 ]};
 const dir=mkdtempSync(path.join(tmpdir(),'eblrt-names-'));
 try{
  const b=exportEV3RT(p,{name:'Names'});for(const [n,c]of Object.entries(b.files))writeFileSync(path.join(dir,path.basename(n)),c);
  const mock=splitRuntimeC(readFileSync(new URL('./fixtures/ev3rt-task-host.h',import.meta.url),'utf8'),'ev3api.h');
  writeFileSync(path.join(dir,'ev3api.h'),mock.header);writeFileSync(path.join(dir,'mock-api.c'),mock.implementation.replace('#include "ev3api.h"','#include "ev3api.h"\n#undef fopen'));
  writeFileSync(path.join(dir,'target_test.h'),'');
  writeFileSync(path.join(dir,'host.c'),'#include "app.c"\nER act_tsk(ID id){return E_OK;}\nint main(void){lab_values r=outer(20,50);if(r.value[0]!=30)return 1;puts("NAMES PASS");return 0;}');
  const bin=path.join(dir,process.platform==='win32'?'host.exe':'host');
  const c=spawnSync(gcc,['-std=gnu99','-O1','-pthread','-I',dir,...['host.c','mock-api.c','ebl_myblocks.c','ebl_rt_runtime.c'].map(f=>path.join(dir,f)),'-lm','-o',bin],{env,encoding:'utf8',timeout:20000});assert.equal(c.status,0,c.stderr);
  const run=spawnSync(bin,[],{env,encoding:'utf8',timeout:8000});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/NAMES PASS/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
