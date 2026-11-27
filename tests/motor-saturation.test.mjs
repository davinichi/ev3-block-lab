import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../dist/ev3.js';
import {runParallel} from './helpers/parallel-vm.mjs';
import {scanImage} from './helpers/image-scan.mjs';
const run=main=>{const b=compile({main,procedures:[]});scanImage(b.data);return runParallel(b.data);};
test('motor speeds saturate before DATA32 conversion for constants and calculations',()=>{
 for(const n of [101,-101,1e30,-1e30,99.9,-99.9]){
  const expected=Math.trunc(Math.max(-100,Math.min(100,Math.fround(n))));
  for(const speed of [n,{op:'add',left:{var:'speed'},right:0}]){
   const r=run([{type:'set',var:'speed',value:n},{type:'motorRun',ports:2,speed}]);
   assert.equal(r.stopped,false);assert.equal(r.events.find(e=>e.type==='motorRun').speed,expected);
  }
 }

 for(const requested of [150,-150]){
  const b=compile({main:[{type:'motorRun',ports:2,speed:{callValue:{name:'requested',args:[requested]}}}],procedures:[{name:'requested',params:['n'],returns:true,result:{param:'n'},body:[]}]});
  const r=runParallel(b.data);assert.equal(r.stopped,false);assert.equal(r.events.find(e=>e.type==='motorRun').speed,Math.sign(requested)*100);
 }
});
test('tank clamps each side independently without changing the calculation result',()=>{
 const r=run([{type:'set',var:'correction',value:200},{type:'tank',leftPort:2,rightPort:4,leftSpeed:{op:'add',left:50,right:{var:'correction'}},rightSpeed:{op:'sub',left:50,right:{var:'correction'}}}]);
 assert.equal(r.stopped,false);assert.equal(r.shared.getFloat32(0,true),200);
 assert.deepEqual(r.events.find(e=>e.type==='motorRun').speeds.map(e=>e.speed),[100,-100]);
});
test('steering speed is bounded while steering range and nonfinite values stay guarded',()=>{
 const r=run([{type:'steering',leftPort:2,rightPort:4,action:'run',turn:0,speed:250}]);
 assert.equal(r.stopped,false);assert.equal(r.events.find(e=>e.type==='motorSync').speed,100);
 assert.throws(()=>run([{type:'motorRun',ports:2,speed:Infinity}]));
 assert.throws(()=>run([{type:'steering',leftPort:2,rightPort:4,action:'run',turn:101,speed:20}]));
});
