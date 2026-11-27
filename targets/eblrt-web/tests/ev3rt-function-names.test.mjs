import test from 'node:test';
import assert from 'node:assert/strict';
import {myBlockFunctionNames} from '../dist/ev3rt-identifiers.js';
import {exportEV3RT} from '../dist/ev3rt.js';

test('My Block function names remain deterministic, valid and unique',()=>{
 const names=['forward','turn_left','forward','合図','int','main_task','lab_proc_0','ev3_motor_stop','printf','sig_sem','assert','_hidden','1turn','turn left','NAME','a'.repeat(64),'x); /*'];
 const ids=myBlockFunctionNames(names);
 assert.deepEqual(myBlockFunctionNames(['iget_tid','fma','serial_wri_dat']),['lab_proc_0','lab_proc_1','lab_proc_2']);
 assert.deepEqual(ids.slice(0,3),['forward','turn_left','lab_proc_2']);
 assert.equal(new Set(ids).size,ids.length);
 ids.slice(3).forEach((name,i)=>assert.equal(name,'lab_proc_'+(i+3)));
});
test('function names remain consistent across declarations, nested calls, result calls and tasks',()=>{
 const program={main:[{type:'call',name:'forward',args:[20]}],threads:[{kind:'start',body:[{type:'set',var:'answer',value:{callValue:{name:'turn_left',args:[90]}}}]}],procedures:[
  {name:'forward',params:['turn_left'],body:[{type:'set',var:'answer',value:{callValue:{name:'turn_left',args:[{param:'turn_left'}]}}}]},
  {name:'turn_left',params:['angle'],returns:true,results:[{param:'angle'}],body:[]},
  {name:'合図',params:[],body:[{type:'call',name:'forward',args:[1]}]}
 ]};
 const b=exportEV3RT(program),c=b.files['EV3Lab/ebl_myblocks.c'],h=b.files['EV3Lab/ebl_myblocks.h'],app=b.files['EV3Lab/app.c'];
 for(const text of [c,h]){assert.match(text,/lab_values forward\(float lab_arg_0\)/);assert.match(text,/lab_values turn_left\(float angle\)/);assert.match(text,/lab_values lab_proc_2\(void\)/);assert.doesNotMatch(text,/static lab_values/);}
 assert.match(c,/= turn_left\(/);assert.match(c,/lab_number\(lab_arg_0\)/);assert.match(app,/= forward\(/);assert.match(app,/= turn_left\(/);
 assert.match(c,/マイブロック「合図」をCの関数 lab_proc_2/);assert.match(c,/引数「turn_left」 → lab_arg_0/);
});
