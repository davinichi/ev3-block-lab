import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../dist/ev3.js';
import {runParallel} from './helpers/parallel-vm.mjs';
import {scanImage} from './helpers/image-scan.mjs';
const set=(name,value)=>({type:'set',var:name,value}),wait=seconds=>({type:'waitSeconds',seconds});
const pid=(target,measured,kp=1,ki=0,kd=0,name='PID1')=>({pid:{name,target,measured,kp,ki,kd}});
const run=(main,options={},procedures=[],threads=[])=>{const b=compile({main,procedures,threads});scanImage(b.data);const result=runParallel(b.data,{maxTime:100000,...options});const names=[];const visit=x=>{if(!x||typeof x!=='object')return;if(typeof x.var==='string'&&!names.includes(x.var))names.push(x.var);for(const v of Object.values(x))visit(v);};visit(b.program);return {b,result,value:name=>result.shared.getFloat32(names.indexOf(name)*4,true)};};
const near=(a,b)=>assert.ok(Math.abs(a-b)<.0001,`${a} != ${b}`);
test('battery UI_READ returns fresh fractional V and A on the brick and supports numeric operations',()=>{
 const calls=[],r=run([set('voltage',{battery:'voltage'}),set('current',{battery:'current'}),wait(.1),set('later',{battery:'voltage'}),set('power',{op:'mul',left:{var:'voltage'},right:{var:'current'}})],{batteryRead:(kind,time)=>{calls.push({kind,time});return kind===1?(time?7.35:7.45):.125;}});
 near(r.value('voltage'),7.45);near(r.value('current'),.125);near(r.value('later'),7.35);near(r.value('power'),7.45*.125);assert.deepEqual(calls,[{kind:1,time:0},{kind:2,time:0},{kind:1,time:100}]);
});
test('invalid battery samples fail before starting a motor',()=>{
 for(const invalid of [NaN,Infinity,-Infinity]){
  const r=run([set('v',{battery:'voltage'}),{type:'motorRun',ports:2,speed:20}],{batteryRead:()=>invalid});
  assert.equal(r.result.events.some(e=>e.type==='motorRun'),false);assert.ok(r.result.stopped);assert.equal(r.result.events.filter(e=>e.type==='tone').at(-1).frequency,300);
 }
 assert.throws(()=>compile({main:[set('v',{battery:'charge'})],procedures:[]}),/バッテリー/);
});
test('PID uses elapsed seconds for integral and derivative with a proportional-only first sample',()=>{
 const r=run([set('a',pid(10,8,1,.5,.25)),wait(.1),set('b',pid(10,8,1,.5,.25)),wait(.2),set('c',pid(10,9,1,.5,.25))]);
 near(r.value('a'),2);near(r.value('b'),2.1);near(r.value('c'),-.05);assert.equal(r.result.stopped,false);
});
test('PID reset, distinct names, zero elapsed time and long idle intervals maintain valid state',()=>{
 const r=run([set('a',pid(10,8,2,1,1)),set('cached',pid(10,0,2,1,1)),set('other',pid(10,7,2,1,1,'Other')),wait(.1),set('b',pid(10,8,2,1,1)),{type:'pidReset',name:'PID1'},set('reset',pid(10,7,2,1,1)),wait(.1),set('other2',pid(10,7,2,1,1,'Other'))]);
 near(r.value('a'),4);near(r.value('cached'),4);near(r.value('other'),6);near(r.value('b'),4.2);near(r.value('reset'),6);near(r.value('other2'),6.6);
 const stale=run([set('first',pid(10,9,1,1,1)),wait(60),wait(.001),set('later',pid(10,8,1,1,1))]);near(stale.value('later'),2);
});
test('PID with zero or signed gains stays finite and output is explicitly clamped by the user',()=>{
 const r=run([set('zero',pid(10,8,0,0,0)),wait(.02),set('i',pid(10,8,0,1,0)),set('limited',{numeric:{op:'clamp',a:pid(10,8,100,0,0,'motor'),low:-100,high:100}}),set('reverse',pid(10,8,-1,0,0,'reverse'))]);
 near(r.value('zero'),0);near(r.value('i'),.04);near(r.value('limited'),100);near(r.value('reverse'),-2);
});
test('PID state survives My Block calls and is serialized across concurrent same-name callers',()=>{
 const body=[set('first',pid({param:'goal'},8,1,1,0))],r=run([{type:'call',name:'calc',args:[10]},wait(.1),{type:'call',name:'calc',args:[10]}],{},[{name:'calc',params:['goal'],body}]);near(r.value('first'),2.2);
 const p=run([{type:'pidReset',name:'shared'},set('x',pid(10,8,1,1,0,'shared')),wait(.1),set('x2',pid(10,8,1,1,0,'shared'))],{},[],[{kind:'start',body:[wait(.1),set('y',pid(10,8,1,1,0,'shared'))]}]);assert.ok(Math.abs(p.value('x2')-p.value('y'))<.01);assert.ok(Math.abs(p.value('y')-2.2)<.01);
});
test('PID guards nonfinite inputs and overflow, and rejects invalid names or too many controllers',()=>{
 for(const value of [NaN,Infinity])assert.throws(()=>compile({main:[set('v',pid(10,8,value))],procedures:[]}));
 for(const name of ['', 'a'.repeat(41),'a\0b'])assert.throws(()=>compile({main:[{type:'pidReset',name}],procedures:[]}),/PID/);
 assert.throws(()=>compile({main:Array.from({length:17},(_,i)=>set('v',pid(0,0,1,0,0,'PID'+i))),procedures:[]}),/16/);
 const r=run([set('v',pid(3e38,-3e38,1,0,0)),{type:'motorRun',ports:2,speed:20}]);assert.ok(r.result.stopped);assert.equal(r.result.events.some(e=>e.type==='motorRun'),false);
});

test('PID uses its own clock across timer resets and keeps signed fractional error',()=>{
 const r=run([set('first',pid(0,-.5,1,1,0)),wait(.1),{type:'timerReset'},set('second',pid(0,-.5,1,1,0))]);near(r.value('first'),.5);near(r.value('second'),.55);
});

test('PID output drives a simulated encoder feedback motor toward positive and negative targets with explicit speed limits',()=>{
 for(const target of [90,-90]){
  const motor={position:[0,0,0,0],speed:[0,0,0,0],setSpeed(ports,speed){for(let i=0;i<4;i++)if(ports&(1<<i))this.speed[i]=speed;},startContinuous(ports,speed){this.setSpeed(ports,speed);},stop(ports){this.setSpeed(ports,0);},advance(ms){for(let i=0;i<4;i++)this.position[i]+=this.speed[i]*ms/100;}};
  const command={type:'motorRun',ports:2,speed:{numeric:{op:'clamp',a:pid(target,{sensor:{kind:'encoder',port:2}},1,0,.01),low:-20,high:20}}};
  const r=run([{type:'pidReset',name:'PID1'},{type:'repeat',count:100,body:[command,wait(.02)]}],{motorDriver:motor});
  assert.ok(Math.abs(motor.position[1]-target)<2);assert.equal(motor.speed[1],0);assert.ok(r.result.events.filter(e=>e.type==='motorRun').every(e=>Math.abs(e.speed)<=20));
 }
});
