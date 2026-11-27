import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../dist/ev3.js';
import {DISPLAY_IMAGES,presetBitmap,emitDisplay,validateDisplay} from '../dist/display.js';
import {scanImage} from './helpers/image-scan.mjs';
import {runParallel} from './helpers/parallel-vm.mjs';
const image=(name='smile')=>({type:'displayBitmap',x:0,y:0,bitmap:presetBitmap(name)});
const number=value=>({type:'displayNumber',x:0,y:100,font:0,decimals:2,value});
test('every face and direction has valid native drawing boundaries at both supported sizes',()=>{
 for(const [,name] of DISPLAY_IMAGES)for(const size of [48,96]){
  const b={...image(name),bitmap:presetBitmap(name,size)};validateDisplay(b);
  const data=compile({main:[{type:'displayClear'},b,{type:'waitSeconds',seconds:1}],procedures:[]}).data;
  const instructions=scanImage(data);assert.ok(data.length<65536);assert.ok(instructions.filter(i=>i.op===0x84).length>10);
 }
});
test('bitmap drawing recreates only the specified black pixels and clears exactly its own rectangle',()=>{
 const b={type:'displayBitmap',x:20,y:30,bitmap:{width:5,height:3,rows:['11001','00000','01110']}};
 const calls=[];emitDisplay(b,{emit:(op,...args)=>calls.push({op,args}),constant:x=>x});
 assert.deepEqual(calls.map(x=>x.args),[[18,0],[9,0,20,30,5,3],[3,1,20,30,21,30],[3,1,24,30,24,30],[3,1,21,32,23,32],[0]]);
});
test('all arrows point in the stated direction, and scaling retains the 2x pixel pattern',()=>{
 const up=presetBitmap('up'),down=presetBitmap('down'),left=presetBitmap('left'),right=presetBitmap('right');
 assert.deepEqual(down.rows,[...up.rows].reverse().map(r=>r.split('').reverse().join('')));
 assert.deepEqual(right.rows,left.rows.map(r=>r.split('').reverse().join('')));
 assert.equal(up.rows[7][24],'1');assert.equal(up.rows[7][18],'0');
 const big=presetBitmap('smile',96);const small=presetBitmap('smile');
 assert.equal(big.width,small.width*2);assert.ok(big.rows.some(r=>r.includes('1')));
});
test('display rejects malformed data, off-screen coordinates and unsupported numeric formats',()=>{
 for(const b of [{...image(),x:150},{...image(),y:-1},{...image(),bitmap:{width:2,height:1,rows:['1x']}},{...number(1),font:3},{...number(1),decimals:4},{...number(1),font:2,x:19}])assert.throws(()=>compile({main:[b],procedures:[]}),/画面|位置|数値/);
 assert.throws(()=>presetBitmap('missing'),/画像/);
});
test('displayed fractional sensor and parameter values are read at runtime, including nested My Blocks',()=>{
 const p={main:[{type:'call',name:'表示',args:[-12.75]},number({sensor:{kind:'distance',port:2}})],procedures:[{name:'表示',params:['n'],body:[number({param:'n'})]}]};
 const data=compile(p).data;scanImage(data);
 const run=runParallel(data,{sensorRead:()=>13.5});const draws=run.events.filter(e=>e.type==='draw'&&e.cmd===8);
 // 距離センサの値は既存仕様どおり整数cm。表示は読み取った値に手を加えない。
 assert.deepEqual(draws.map(d=>d.args.slice(3)),[[-12.75,-10,2],[13,-10,2]]);
});
test('parallel display sequences finish UPDATE before another task changes the framebuffer',()=>{
 const p={main:[image('smile')],threads:[{kind:'start',body:[image('heart')]}],procedures:[]};
 const data=compile(p).data;scanImage(data);const run=runParallel(data),draws=run.events.filter(e=>e.type==='draw');
 let owner=null,frames=0;for(const d of draws){if(owner===null)owner=d.task;assert.equal(d.task,owner);if(d.cmd===0){owner=null;frames++;}}
 assert.equal(frames,2);assert.equal(owner,null);assert.equal(run.tasks,0);
});
