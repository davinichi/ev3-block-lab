import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportEV3RT} from '../dist/ev3rt.js';
import {sourceZip} from '../dist/source-zip.js';
import {splitRuntimeC} from '../dist/ev3rt-c-modules.js';

test('student source links independent My Block and runtime C modules with one shared-state definition',()=>{
 const p={main:[{type:'set',var:'回数',value:1},{type:'call',name:'合図',args:[440]}],threads:[{kind:'message',message:'終了',body:[{type:'programEnd'}]}],procedures:[{name:'合図',params:['周波数'],body:[{type:'tone',frequency:{param:'周波数'},ms:50,volume:10}]}]};
 const b=exportEV3RT(p,{name:'Learner'}),c=b.files['Learner/app.c'],runtime=b.files['Learner/ebl_rt_runtime.h'];
 assert.equal((c.match(/#include "ebl_rt_runtime.h"/g)||[]).length,1);
 const functions=b.files['Learner/ebl_myblocks.c'],declarations=b.files['Learner/ebl_myblocks.h'],implementation=b.files['Learner/ebl_rt_runtime.c'];
 assert.doesNotMatch(c,/lab_values lab_proc_0\(/);
 assert.match(functions,/lab_values lab_proc_0\(float lab_arg_0\)/);
 assert.match(declarations,/lab_values lab_proc_0\(float lab_arg_0\);/);
 assert.match(c,/void lab_task_0\(intptr_t exinf\)/);assert.match(c,/void main_task\(intptr_t exinf\)/);
 assert.doesNotMatch(c,/static void lab_poll\(void\)|static void lab_finite\(|lab_context_t lab_contexts/);
 assert.match(runtime,/#pragma once/);assert.match(runtime,/void lab_poll\(void\)/);assert.match(runtime,/EBLの変数「回数」/);
 assert.match(runtime,/extern float lab_var_0;/);assert.doesNotMatch(runtime,/float lab_var_0\s*=/);
 assert.match(implementation,/float lab_var_0;/);assert.match(implementation,/void lab_poll\(void\) \{/);
 for(const text of [c,functions,implementation])assert.doesNotMatch(text,/#include "[^"]+\.c"/);
 assert.doesNotMatch(runtime,/\nvoid (?:main_task|lab_task_\d+)\(/);
 assert.match(b.files['Learner/Makefile.inc'],/ebl_myblocks\.o ebl_rt_runtime\.o/);
 assert.match(b.files['Learner/app.cfg'],/ATT_MOD\("ebl_rt_runtime\.o"\)/);
 assert.match(b.files['Learner/app.cfg'],/ATT_MOD\("ebl_myblocks\.o"\)/);
 assert.match(b.files['Learner/CODE_GUIDE.txt'],/同じフォルダー/);
 const zip=Buffer.from(sourceZip(b.files));assert.ok(zip.includes(Buffer.from('Learner/ebl_rt_runtime.h')));
});

test('runtime split boundaries cannot be spoofed by project labels',()=>{
 const name='#include <math.h>\n/* ===== */';
 const p={main:[{type:'set',var:name,value:1},{type:'call',name,args:[]}],procedures:[{name,params:[],body:[{type:'wait',ms:1}]}]};
 const b=exportEV3RT(p),c=b.files['EV3Lab/app.c'],h=b.files['EV3Lab/ebl_rt_runtime.h'];
 assert.match(b.files['EV3Lab/ebl_myblocks.c'],/lab_values lab_proc_0/);assert.match(h,/void lab_poll/);
 assert.doesNotMatch(c+h,/\/\* EBL_COMMENT_\d+ \*\//);
});
test('module declarations retain types and storage qualifiers but never duplicate initializers',()=>{
 const source='typedef struct {int n;} item;\nstatic volatile int one=1,two[2]={2,3};\nstatic const char *text="static lab_fake() { a,b=4; }";\nstatic int f(int x) {static int local;return one+x+local;}\n';
 const {header,implementation}=splitRuntimeC(source);
 assert.match(header,/extern volatile int one,two\[2\];/);
 assert.match(header,/extern const char \*text;/);
 assert.doesNotMatch(header,/one=1|two\[2\]=|lab_fake/);
 assert.match(implementation,/volatile int one=1,two\[2\]=\{2,3\};/);
 assert.match(implementation,/static int local/);
 assert.match(implementation,/"static lab_fake\(\) \{ a,b=4; \}"/);
});
test('My Block marker text in project labels cannot move code between modules',()=>{
 const name='/* EBL_MYBLOCKS_END */ static lab_values lab_proc_0(';
 const b=exportEV3RT({main:[{type:'call',name,args:[]}],procedures:[{name,params:[],body:[{type:'wait',ms:1}]}]});
 const withoutComments=text=>text.replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(withoutComments(b.files['EV3Lab/app.c']),/lab_values lab_proc_0\(/);
 assert.match(withoutComments(b.files['EV3Lab/ebl_myblocks.c']),/lab_values lab_proc_0\(void\) \{/);
});
