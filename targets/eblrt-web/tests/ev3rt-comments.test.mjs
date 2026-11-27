import {expandedSource} from './ev3rt-source.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportEV3RT} from '../dist/ev3rt.js';
import {safeComment} from '../dist/ev3rt-comments.js';
import {compile} from '../dist/ev3.js';
test('learning comments map original variables, My Blocks and block operations without altering IR/RBF',()=>{
 const p={main:[{type:'set',var:'回数',value:3},{type:'repeat',count:{var:'回数'},body:[{type:'call',name:'合図',args:[440]}]}],procedures:[{name:'合図',params:['周波数'],body:[{type:'tone',frequency:{param:'周波数'},ms:100,volume:15}]}]};
 const snapshot=JSON.stringify(p),rbf=compile(p).data;
 const b=exportEV3RT(p),c=expandedSource(b);
 for(const text of ['ブロックから生成したプログラム','EBLの変数「回数」','マイブロック「合図」','引数「周波数」 → lab_arg_0','回、波括弧','Hzの音を'])assert.ok(c.includes(text),text);
 assert.match(b.files['EV3Lab/CODE_GUIDE.txt'],/float/);assert.match(b.files['EV3Lab/app.cfg'],/TA_ACT：/);
 assert.equal(JSON.stringify(p),snapshot);assert.deepEqual(compile(p).data,rbf);
});
test('task comments identify condition, change and message handlers plus supervisor duties',()=>{
 const p={main:[{type:'wait',ms:1}],threads:[{kind:'condition',condition:{sensor:{kind:'touch',port:1}},body:[{type:'broadcast',message:'開始',wait:false}]},{kind:'message',message:'開始',body:[{type:'wait',ms:10}]},{kind:'changed',condition:{timer:true},body:[]}],procedures:[]};
 const b=exportEV3RT(p),c=expandedSource(b);
 for(const text of ['main_task は起動と停止','メッセージ「開始」を受け取る処理','最初に読んだ値を基準','偽から真になったとき','監督用のメインタスク','共有データを1タスクずつ'])assert.ok((c+b.files['EV3Lab/app.cfg']).includes(text),text);
});
test('project labels cannot close generated C comments or inject preprocessor code',()=>{
 const name='値*/\n#error BAD\n/*';
 const p={main:[{type:'set',var:name,value:1},{type:'call',name,args:[]}],procedures:[{name,params:[],body:[{type:'wait',ms:1}]}]};
 const c=expandedSource(exportEV3RT(p)),without=c.replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(without,/#error|BAD/);assert.equal((c.match(/\/\*/g)||[]).length,(c.match(/\*\//g)||[]).length);
 assert.doesNotMatch(safeComment(name),/\/\*|\*\/|\n/);
});
test('labels that look like runtime templates cannot alter task generation',()=>{
 const p={main:[{type:'set',var:'static void lab_poll(void) {',value:1},{type:'call',name:'void main_task(intptr_t exinf) {',args:[]}],threads:[{kind:'message',message:'static void lab_motion(',body:[]}],procedures:[{name:'void main_task(intptr_t exinf) {',params:[],body:[{type:'wait',ms:1}]}]};
 const c=expandedSource(exportEV3RT(p)),without=c.replace(/\/\*[\s\S]*?\*\//g,'');
 assert.match(without,/void lab_poll\(void\) \{\s*if \(lab_stopping\) lab_fail\(\);/);
 assert.equal((without.match(/void main_task\(intptr_t exinf\) \{/g)||[]).length,1);
 assert.match(without,/lab_proc_0\(\)/);assert.doesNotMatch(c,/\/\* EBL_COMMENT_\d+ \*\//);
});
