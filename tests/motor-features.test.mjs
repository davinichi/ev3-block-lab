import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../dist/ev3.js';
import {scanImage} from './helpers/image-scan.mjs';
import {runParallel} from './helpers/parallel-vm.mjs';
const wait=seconds=>({type:'waitSeconds',seconds});
const set=(name,value)=>({type:'set',var:name,value});
const stopMode=(ports,mode)=>({type:'stopMode',ports,mode});
const build=(main,procedures=[],threads=[])=>{const b=compile({main,procedures,threads});scanImage(b.data);return b;};
class Motors{
 time=0;position=[0,0,0,0];speed=[0,0,0,0];end=[null,null,null,null];target=[null,null,null,null];started=0;
 start(ports,speed,degrees){this.started++;for(let i=0;i<4;i++)if(ports&(1<<i)){this.speed[i]=speed;this.target[i]=this.position[i]+Math.sign(speed)*degrees;}}
 startContinuous(ports,speed){this.start(ports,speed,Infinity);}
 setSpeed(ports,speed){for(let i=0;i<4;i++)if(ports&(1<<i))this.speed[i]=speed;}
 setPower(ports,power){this.setSpeed(ports,power);}
 actualSpeed(i){return this.speed[i];}
 startTimed(ports,speed,ms){this.startContinuous(ports,speed);for(let i=0;i<4;i++)if(ports&(1<<i))this.end[i]=this.time+ms;}
 velocities(ports,speed,turn){const p=[0,1,2,3].filter(i=>ports&(1<<i));return [[p[0],turn>=0?speed:speed*(1+turn/100)],[p[1],turn>=0?speed*(1-turn/100):speed]];}
 startSync(ports,speed,turn,degrees){for(const [i,s]of this.velocities(ports,speed,turn))if(s)this.start(1<<i,s,degrees*Math.abs(s/speed));else this.stop(1<<i);}
 startSyncTimed(ports,speed,turn,ms){for(const [i,s]of this.velocities(ports,speed,turn))this.startTimed(1<<i,s,ms);}
 stop(ports){for(let i=0;i<4;i++)if(ports&(1<<i)){this.speed[i]=0;this.target[i]=null;this.end[i]=null;}}
 busy(ports){return this.target.some((v,i)=>v!==null&&ports&(1<<i));}
 advance(ms){for(let i=0;i<4;i++)if(this.target[i]!==null){const duration=this.end[i]===null?ms:Math.min(ms,Math.max(0,this.end[i]-this.time)),next=this.position[i]+this.speed[i]*duration/100;this.position[i]=this.speed[i]>0?Math.min(next,this.target[i]):Math.max(next,this.target[i]);if(this.position[i]===this.target[i]||this.end[i]!==null&&this.time+ms>=this.end[i])this.stop(1<<i);}this.time+=ms;}
}

test('finite tank signs and speed ratios map to native ordered-port sync for all port orders',()=>{
 for(const leftPort of [1,2,4,8])for(const rightPort of [1,2,4,8])if(leftPort!==rightPort)for(const [leftSpeed,rightSpeed]of [[40,20],[20,40],[-40,-20],[-20,-40],[40,-20],[-20,40],[0,40],[40,0],[40,-40],[-40,40]]){
  const b=build([{type:'tankFinite',leftPort,rightPort,leftSpeed,rightSpeed,action:'angle',degrees:360}]),motors=new Motors(),r=runParallel(b.data,{motorDriver:motors,maxTime:5000});
  const fast=Math.max(Math.abs(leftSpeed),Math.abs(rightSpeed));
  assert.equal(motors.position[Math.log2(leftPort)],360*leftSpeed/fast);assert.equal(motors.position[Math.log2(rightPort)],360*rightSpeed/fast);
  assert.equal(r.events.filter(e=>e.type==='motorSync').length,1);assert.equal(r.tasks,0);
 }
});
test('finite tank seconds allow fractional duration and keep independent sensor sampling active',()=>{
 const b=build([{type:'tankFinite',leftPort:8,rightPort:1,leftSpeed:-30,rightSpeed:15,action:'time',seconds:.5}],[],[{kind:'start',body:[{type:'repeat',count:5,body:[set('d',{sensor:{kind:'distance',port:2}}),wait(.05)]}]}]),motors=new Motors();
 const r=runParallel(b.data,{motorDriver:motors,sensorRead:()=>10});assert.ok(Math.abs(motors.position[3]+150)<1e-8);assert.ok(Math.abs(motors.position[0]-75)<1e-8);assert.equal(r.sensorLog.length,5);assert.ok(r.sensorLog.every(s=>s.time<500));
 assert.equal(r.events.find(e=>e.type==='steeringTime').ms,500);
});
test('raw power starts unregulated output, whereas changing speed alone does not start a motor',()=>{
 const b=build([{type:'motorPower',ports:9,speed:-25.8},wait(.1),{type:'stop',ports:9}]),motors=new Motors(),r=runParallel(b.data,{motorDriver:motors});assert.deepEqual(r.events.find(e=>e.type==='power'),{type:'power',ports:9,power:-25,time:0});assert.ok(motors.position[0]<0&&motors.position[3]<0);
 const motor2=new Motors();runParallel(build([{type:'motorSpeedSet',ports:2,speed:20},wait(.1)]).data,{motorDriver:motor2});assert.equal(motor2.started,0);assert.deepEqual(motor2.position,[0,0,0,0]);
});
test('actual-speed reporter reads signed measured output rather than the requested speed',()=>{
 for(const actual of [-100,-37,0,42,100])for(const port of [1,2,3,4]){
  const motors=new Motors();motors.actualSpeed=()=>actual;
  const b=build([set('actual',{sensor:{kind:'motorSpeed',port}})]),r=runParallel(b.data,{motorDriver:motors});assert.equal(r.shared.getFloat32(0,true),actual);
 }
 assert.throws(()=>build([set('x',{sensor:{kind:'motorSpeed',port:5}})]),/ポート/);
});
test('stop choices distinguish immediate coast, active hold and brief braking followed by release',()=>{
 for(const mode of ['coast','hold','brake']){
  const b=build([{type:'motorRun',ports:2,speed:20},wait(.1),{type:'stop',ports:2,stopMode:mode},wait(.2)]),r=runParallel(b.data,{motorDriver:new Motors()});
  const stop=r.events.filter(e=>e.type==='stop'&&e.ports===2);
  assert.equal(stop[0].brake,mode==='coast'?0:1);assert.equal(stop[0].time,100);
  assert.equal(stop.length,mode==='brake'?2:1);if(mode==='brake'){assert.equal(stop[1].brake,0);assert.equal(stop[1].time,200);}
 }
});
test('per-port stop settings affect finite angle and time without altering other ports',()=>{
 for(const action of ['motor','motorTimed']){
  const motion={type:action,ports:6,speed:20,...(action==='motor'?{degrees:30}:{seconds:.15})};
  const b=build([stopMode(2,'coast'),stopMode(4,'hold'),motion,wait(.2)]),r=runParallel(b.data,{motorDriver:new Motors()});
  const moves=r.events.filter(e=>e.type===(action==='motor'?'motor':'motorTimed'));assert.deepEqual(moves.map(x=>[x.ports,x.brake]),[[2,0],[4,1]]);
 }
});
test('configured finite brake releases after completion; hold remains while the program runs',()=>{
 for(const mode of ['brake','hold','coast']){
  const b=build([stopMode(2,mode),{type:'motor',ports:2,speed:20,degrees:20},wait(.2)]),r=runParallel(b.data,{motorDriver:new Motors()});
  const moves=r.events.filter(e=>e.type==='motor');assert.equal(moves[0].brake,mode==='coast'?0:1);
  const releases=r.events.filter(e=>e.type==='stop'&&e.ports===2&&e.brake===0);assert.equal(releases.length,mode==='brake'?1:0);if(mode==='brake')assert.equal(releases[0].time,200);
 }
});
test('native sync supports shared coast mode and rejects conflicting settings before starting motion',()=>{
 const move={type:'tankFinite',leftPort:2,rightPort:4,leftSpeed:30,rightSpeed:15,action:'angle',degrees:90};
 const a=build([stopMode(6,'coast'),move]);const r=runParallel(a.data,{motorDriver:new Motors()});assert.equal(r.events.find(e=>e.type==='motorSync').brake,0);
 const b=build([stopMode(2,'coast'),stopMode(4,'hold'),move]),bad=runParallel(b.data,{motorDriver:new Motors()});assert.ok(bad.stopped);assert.equal(bad.events.filter(e=>e.type==='motorSync').length,0);
});
test('half and fractional rotations compile as exact degree targets inside My Blocks',()=>{
 const call=rotations=>({type:'call',name:'回す',args:[rotations]});
 const b=build([call(.5),call(1.25)],[{name:'回す',params:['回転'],body:[{type:'motorRotations',ports:1,speed:-20,rotations:{param:'回転'}}]}]),r=runParallel(b.data,{motorDriver:new Motors(),maxTime:5000});
 assert.deepEqual(r.events.filter(e=>e.type==='motor').map(e=>e.degrees),[180,450]);
});
test('new motor operations validate constants and guard runtime values before moving',()=>{
 for(const invalid of [{type:'motorPower',ports:1,speed:101},{type:'motorSpeedSet',ports:0,speed:20},{type:'stopMode',ports:2,mode:'invalid'},{type:'tankFinite',leftPort:2,rightPort:2,leftSpeed:20,rightSpeed:20,action:'time',seconds:1},{type:'tankFinite',leftPort:2,rightPort:4,leftSpeed:0,rightSpeed:0,action:'angle',degrees:360}])assert.throws(()=>build([invalid]));
 const b=build([set('speed',{sensor:{kind:'distance',port:2}}),{type:'motorPower',ports:1,speed:{var:'speed'}}]),r=runParallel(b.data,{sensorRead:()=>150});assert.ok(r.stopped);assert.equal(r.events.filter(e=>e.type==='power').length,0);
});
test('coast and hold settings survive ramped finite and feedback native image generation',()=>{
 for(const mode of ['coast','hold','brake'])for(const ramp of ['off','scurve'])for(const sync of ['independent','feedback','sync']){
  build([stopMode(6,mode),{type:'ramp',mode:ramp,upSeconds:.1,downSeconds:.1},{type:'motor',ports:6,speed:30,degrees:90,mode:sync},{type:'motorTimed',ports:6,speed:30,seconds:.5}]);
 }
});
