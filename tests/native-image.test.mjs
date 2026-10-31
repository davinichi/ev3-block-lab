import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compile} from '../dist/ev3.js';

import {scanImage} from './helpers/image-scan.mjs';
const tone=frequency=>({type:'tone',frequency,ms:200,volume:25});
test('early whole-program and My Block exits keep all native object and jump boundaries valid',()=>{
 for(const type of ['programEnd','myblockReturn']){
  const p={main:[{type:'call',name:'exit',args:[]},tone(880)],procedures:[{name:'exit',params:[],body:[{type:'repeat',count:2,body:[{type:'if',condition:{button:{id:4}},then:[{type}],else:[tone(440)]}]}]}]};
  const instructions=scanImage(compile(p).data);assert.equal(instructions.filter(x=>x.op===0x0a).length,2);assert.ok(instructions.some(x=>x.op===(type==='programEnd'?2:8)));
 }
});
test('native button PRESSED operands and float conditions have valid object boundaries in My Blocks and loops',()=>{
 const condition={op:'eq',left:{button:{id:7}},right:0};
 const p={main:[{type:'call',name:'buttons',args:[.5]}],procedures:[{name:'buttons',params:['n'],body:[{type:'while',until:true,condition,body:[{type:'waitSeconds',seconds:{param:'n'}}]},tone(880)]}]};
 const instructions=scanImage(compile(p).data);assert.equal(instructions.filter(x=>x.op===0x83).length,5);
});

test('encoder reset and all infrared dataset counts preserve firmware instruction and object boundaries',()=>{
 const values=[{sensor:{kind:'encoder',port:4}},{sensor:{kind:'touch',port:1}},{sensor:{kind:'infrared',port:2}},...['irRemote','irBeaconDetected','irBeaconHeading','irBeaconDistance'].map(kind=>({sensor:{kind,port:3,channel:4}}))];
 const p={main:[{type:'encoderReset',port:4},{type:'call',name:'読む',args:[]}],procedures:[{name:'読む',params:[],body:values.map((value,i)=>({type:'set',var:'v'+i,value:{math:{fn:'abs',value}}}))}]};
 const instructions=scanImage(compile(p).data);assert.ok(instructions.some(i=>i.op===0xb2));assert.ok(instructions.some(i=>i.op===0xb3));
});
const screenshot={main:[{type:'wheel',diameter:56},{type:'tread',mm:120},{type:'forever',body:[{type:'if',condition:{op:'lt',left:{sensor:{kind:'distance',port:2}},right:15},then:[tone(440)],else:[tone(880)]}]}],procedures:[]};

test('reported ultrasonic/forever image has no trailing instructions after OBJECT_END',()=>{
 const build=compile(screenshot),instructions=scanImage(build.data);
 assert.equal(instructions.filter(x=>x.op===0x0a).length,1);
 // Recreate the faulty early-END layout. The execution VM skipped these bytes;
 // firmware scanning must reject them even when the error path never executes.
 const bad=build.data.slice(),skip=instructions.find(x=>x.op===0x40&&x.end<bad.length-1&&new DataView(bad.buffer).getInt32(x.end-4,true)+x.end===bad.length-1);
 assert.ok(skip);bad[skip.at]=0x0a;assert.throws(()=>scanImage(bad),/boundary/);
});

test('all object boundaries and jumps remain valid with sensor faults in main and multiple My Blocks',()=>{
 const build=compile({main:[{type:'call',name:'sense',args:[]},{type:'call',name:'drive',args:[20]},tone(440)],procedures:[{name:'sense',params:[],body:[{type:'set',var:'x',value:{sensor:{kind:'reflected',port:3}}}]},{name:'drive',params:['speed'],body:[{type:'motorRun',ports:6,speed:{param:'speed'}},{type:'wait',ms:100},{type:'stop'}]}]});
 assert.equal(scanImage(build.data).filter(x=>x.op===0x0a).length,3);
});

test('fault-free sounds and feedback diagnostic FILE instructions retain valid sequential framing',()=>{
 for(const program of [{main:[tone(440)],procedures:[]},{main:[{type:'motor',ports:6,speed:20,degrees:360,mode:'feedback'}],procedures:[]}])scanImage(compile(program).data);
});

test('unary float instructions and float subcall headers pass sequential object framing',()=>{
 const math=(fn,value)=>({math:{fn,value}});
 for(const fn of ['abs','floor','ceil','sqrt','sin','cos','tan','asin','acos','atan','ln','log','exp','pow10']){
  const p={main:[{type:'call',name:'calculate',args:[.5]}],procedures:[{name:'calculate',params:['n'],body:[{type:'set',var:'answer',value:math(fn,{param:'n'})},{type:'if',condition:{op:'gt',left:{var:'answer'},right:0},then:[tone(880)],else:[tone(440)]}]}]};scanImage(compile(p).data);
 }
});

test('ramp control loops and legacy fallback have valid native boundaries and jumps in every mode',()=>{
 for(const mode of ['off','trapezoid','scurve'])for(const ports of [1,6]){
  const build=compile({main:[{type:'call',name:'setup',args:[.5]},{type:'motor',ports,speed:30,degrees:360,mode:'feedback'},{type:'motorTimed',ports,speed:-30,seconds:2}],procedures:[{name:'setup',params:['time'],body:[{type:'ramp',mode,upSeconds:{param:'time'},downSeconds:1},{type:'set',var:'n',value:{math:{fn:'abs',value:.5}}}]}]});
  const instructions=scanImage(build.data);assert.equal(instructions.filter(x=>x.op===0x0a).length,2);assert.ok(instructions.some(x=>x.op===0xa5));assert.ok(instructions.some(x=>x.op===0x87));assert.ok(build.data.length<65536);
 }
});

test('pivot lowering preserves native object boundaries and fault jumps with and without acceleration',()=>{
 for(const mode of [null,'trapezoid','scurve']){
  const p={main:[...(mode?[{type:'ramp',mode,upSeconds:.5,downSeconds:.5}]:[]),{type:'wheel',diameter:56},{type:'tread',mm:112},{type:'call',name:'pivot',args:[90]}],procedures:[{name:'pivot',params:['angle'],body:[{type:'pivot',leftPort:8,rightPort:1,speed:20,angle:{param:'angle'},direction:'left'}]}]};
  const instructions=scanImage(compile(p).data);assert.equal(instructions.filter(x=>x.op===0x0a).length,2);assert.ok(instructions.some(x=>x.op===0xa3));assert.ok(instructions.some(x=>x.op===0xae));
 }
});

test('tank control emits one combined start after both speed settings and keeps branch boundaries valid',()=>{
 const p={main:[{type:'tank',leftPort:2,rightPort:4,leftSpeed:50,rightSpeed:-25},{type:'waitSeconds',seconds:1}],procedures:[]};
 const instructions=scanImage(compile(p).data),start=instructions.filter(x=>x.op===0xa6),speeds=instructions.filter(x=>x.op===0xa5);assert.equal(start.length,1);assert.equal(speeds.length,2);assert.ok(speeds.every(x=>x.at<start[0].at));
});


test('timer reads, resets and shared My Block clocks retain native boundaries with geometry and ramps',()=>{
 for(const settings of [[],[{type:'wheel',diameter:56},{type:'tread',mm:112},{type:'ramp',mode:'scurve',upSeconds:.5,downSeconds:.5}]]){
  const p={main:[...settings,{type:'timerReset'},{type:'call',name:'time',args:[]}],procedures:[{name:'time',params:[],body:[{type:'set',var:'seconds',value:{timer:true}},{type:'while',until:true,condition:{op:'gt',left:{timer:true},right:.5},body:[]},{type:'timerReset'}]}]};
  const instructions=scanImage(compile(p).data);assert.equal(instructions.filter(x=>x.op===0x0a).length,2);assert.ok(instructions.filter(x=>x.op===0x87).length>=4);assert.ok(instructions.some(x=>x.op===0x1f));
 }
});

test('data, UTF-8 strings, CSV and steering frames match firmware operand signatures in all objects',()=>{
 const p={main:[{type:'logStart',file:'Test'},{type:'call',name:'記録',args:[1.5]},{type:'steering',leftPort:8,rightPort:1,speed:20,turn:-35,action:'time',seconds:1},{type:'led',color:1,mode:'pulse'}],procedures:[{name:'記録',params:['値'],body:[{type:'textSet',name:'表示',value:{textOp:'join',a:{text:'値='},b:{textOp:'number',value:{param:'値'}}}},{type:'listAdd',list:'値',value:{param:'値'}},{type:'logValue',label:'日本語',value:{textVar:'表示'}},{type:'logValue',label:'平均',value:{listData:{op:'average',list:'値'}}}]}]};
 const build=compile(p),ops=scanImage(build.data).map(x=>x.op);for(const op of [0x7d,0xc0,0xc1,0xc3,0xc4,0xc8,0xcc,0xb1,0x82])assert.ok(ops.includes(op));
});

test('gyro combined datasets, reset and sensor events retain native firmware boundaries',()=>{
 const program={main:[{type:'gyroReset',port:4},{type:'call',name:'計測',args:[]}],threads:[{kind:'changed',condition:{sensor:{kind:'gyroAngle',port:4}},body:[tone(880)]}],procedures:[{name:'計測',params:[],body:[{type:'set',var:'rate',value:{sensor:{kind:'gyroRate',port:4}}}]}]};
 const built=compile(program);scanImage(built.data);assert.equal(built.usesSensors,true);
});
