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

class ProfileMotors extends Motors{
 commands=[];gains=[1,1,1,1];
 setSpeed(ports,speed){this.commands.push({ports,speed,time:this.time});super.setSpeed(ports,speed);}
 advance(ms){for(let i=0;i<4;i++)if(this.target[i]!==null){const duration=this.end[i]===null?ms:Math.min(ms,Math.max(0,this.end[i]-this.time)),next=this.position[i]+this.speed[i]*this.gains[i]*duration/100;this.position[i]=this.speed[i]>0?Math.min(next,this.target[i]):this.speed[i]<0?Math.max(next,this.target[i]):this.position[i];if(this.position[i]===this.target[i]||this.end[i]!==null&&this.time+ms>=this.end[i])this.stop(1<<i);}this.time+=ms;}
}
const profile=(mode='trapezoid',upSeconds=.5,downSeconds=.5)=>({type:'ramp',mode,upSeconds,downSeconds});

test('movement ramp angle targets retain ratios, signs and ordered ports for tank and steering',()=>{
 for(const mode of ['trapezoid','scurve'])for(const leftPort of [1,2,4,8])for(const rightPort of [1,2,4,8])if(leftPort!==rightPort){
  const cases=[...[[40,20],[20,40],[-40,-20],[40,-20],[-20,40],[0,40],[40,0],[40,-40]].map(([leftSpeed,rightSpeed])=>({type:'tankFinite',leftSpeed,rightSpeed})),...[-100,-50,-25,0,25,50,100].map(turn=>({type:'steering',speed:-40,turn}))];
  for(const command of cases){
   const pair=command.type==='tankFinite'?[command.leftSpeed,command.rightSpeed]:command.turn>=0?[command.speed,Math.trunc(command.speed*(100-2*command.turn)/100)]:[Math.trunc(command.speed*(100+2*command.turn)/100),command.speed];
   const peak=Math.max(...pair.map(Math.abs)),motors=new ProfileMotors();motors.position=[40,-300,720,9];motors.gains=[1,.7,1.1,.9];const initial=[...motors.position];
   const result=runParallel(build([{type:'movementSetup',leftPort,rightPort},profile(mode),{...command,action:'angle',degrees:360,movement:true}]).data,{motorDriver:motors,maxTime:30000});
   assert.equal(result.stopped,false,JSON.stringify({mode,leftPort,rightPort,command}));assert.equal(result.tasks,0);
   for(const [port,speed]of [[leftPort,pair[0]],[rightPort,pair[1]]])assert.ok(Math.abs(motors.position[Math.log2(port)]-initial[Math.log2(port)]-Math.sign(speed)*Math.round(360*Math.abs(speed)/peak))<1e-6);
   for(let i=0;i<4;i++)if(!((leftPort|rightPort)&1<<i))assert.equal(motors.position[i],initial[i]);
   assert.ok(motors.commands.every(c=>(c.ports&(leftPort|rightPort))===c.ports&&Math.abs(c.speed)<=peak));
  }
 }
});

test('movement timed profiles accelerate and decelerate with the selected shape and signed ratio',()=>{
 for(const mode of ['trapezoid','scurve'])for(const pair of [[40,20],[-40,-20],[40,-20],[0,-40]]){
  const motors=new ProfileMotors(),result=runParallel(build([profile(mode,1,1),{type:'tankFinite',leftPort:8,rightPort:1,leftSpeed:pair[0],rightSpeed:pair[1],action:'time',seconds:3}]).data,{motorDriver:motors});
  assert.equal(result.stopped,false);assert.equal(result.time,3000);assert.equal(result.tasks,0);
  for(const [port,speed]of [[8,pair[0]],[1,pair[1]]]){
   const commands=motors.commands.filter(c=>c.ports===port);
   if(!speed){assert.equal(commands.length,0);assert.equal(motors.position[Math.log2(port)],0);continue;}
   const at=t=>commands.find(c=>c.time===t)?.speed;
   assert.equal(at(1000),speed);assert.equal(at(2000),speed);assert.equal(at(500),speed/2);assert.equal(at(2500),speed/2);
   assert.equal(at(200),Math.sign(speed)*Math.max(1,Math.trunc((mode==='trapezoid'?8:4)*Math.abs(speed)/40)));
   assert.ok(commands.every(c=>Math.sign(c.speed)===Math.sign(speed)&&Math.abs(c.speed)<=Math.abs(speed)));
  }
 }
});

test('timed steering uses the same profile for curves, pivots, spins and reversed port order',()=>{
 for(const turn of [-100,-50,-25,0,25,50,100])for(const speed of [-40,40]){
  const motors=new ProfileMotors(),result=runParallel(build([profile('scurve',1,1),{type:'steering',leftPort:8,rightPort:1,turn,speed,action:'time',seconds:3}]).data,{motorDriver:motors});
  assert.equal(result.stopped,false);assert.equal(result.time,3000);
  const pair=turn>=0?[speed,speed*(100-2*turn)/100]:[speed*(100+2*turn)/100,speed];
  for(const [port,s]of [[8,pair[0]],[1,pair[1]]])if(s)assert.equal(motors.commands.find(c=>c.ports===port&&c.time===1000).speed,s);else assert.equal(motors.position[Math.log2(port)],0);
 }
});

test('tiny angle ratios never start a zero-degree infinite move and stopped sides never restart old speeds',()=>{
 for(const mode of ['trapezoid','scurve'])for(const pair of [[100,1],[1,-100],[0,40]]){
  const motors=new ProfileMotors(),result=runParallel(build([profile(mode,2,2),{type:'tankFinite',leftPort:2,rightPort:4,leftSpeed:pair[0],rightSpeed:pair[1],action:'angle',degrees:1}]).data,{motorDriver:motors,maxTime:15000});
  assert.equal(result.stopped,false);assert.equal(result.tasks,0);assert.ok(result.events.filter(e=>e.type==='motor').every(e=>e.degrees>0));
 }
 const motors=new ProfileMotors(),result=runParallel(build([{type:'motorRun',ports:2,speed:-80},profile(),{type:'tankFinite',leftPort:2,rightPort:4,leftSpeed:0,rightSpeed:40,action:'time',seconds:1}]).data,{motorDriver:motors});
 assert.deepEqual(result.events.filter(e=>e.type==='motorRun').map(e=>e.ports),[2,4]);assert.equal(motors.position[1],0);
});

test('ramp off preserves native sync, while continuous steering and tank remain immediate',()=>{
 const tank={type:'tankFinite',leftPort:2,rightPort:4,leftSpeed:40,rightSpeed:20,action:'time',seconds:.5};
 for(const mode of ['off','trapezoid']){
  const b=build([profile(mode),tank]),r=runParallel(b.data,{motorDriver:new ProfileMotors()});
  assert.equal(r.events.some(e=>e.type==='steeringTime'),mode==='off');
 }
 const r=runParallel(build([profile('scurve',2,2),{type:'steering',leftPort:2,rightPort:4,speed:20,turn:25,action:'run'},wait(.1),{type:'tank',leftPort:2,rightPort:4,leftSpeed:10,rightSpeed:20},wait(.1)]).data,{motorDriver:new ProfileMotors()});
 assert.equal(r.time,200);assert.equal(r.events.find(e=>e.type==='motorSync').speed,20);
});

test('ramped pairs validate both motors before starting and abort stalled finite targets',()=>{
 const move={type:'tankFinite',leftPort:2,rightPort:4,leftSpeed:40,rightSpeed:20,action:'angle',degrees:180};
 const missing=runParallel(build([profile(),move]).data,{motorDriver:new ProfileMotors(),motorTypes:[7,7,0,7]});assert.equal(missing.stopped,true);assert.equal(missing.events.some(e=>e.type==='motor'),false);
 const motors=new ProfileMotors();motors.gains=[1,1,0,1];const stalled=runParallel(build([profile(),move,{type:'tone',frequency:880,volume:25,ms:10}]).data,{motorDriver:motors,maxTime:20000});
 assert.equal(stalled.stopped,true);assert.equal(motors.busy(15),false);assert.equal(stalled.events.some(e=>e.type==='tone'&&e.frequency===880),false);
});

test('parallel sensor measurement continues during ramped shared movement and setup My Blocks',()=>{
 const move={type:'steering',movement:true,turn:{param:'turn'},speed:{param:'speed'},action:'time',seconds:2};
 const b=build([{type:'call',name:'setup',args:[]},{type:'call',name:'curve',args:[25,40]}],[{name:'setup',params:[],body:[{type:'movementSetup',leftPort:8,rightPort:1},profile('scurve')]},{name:'curve',params:['turn','speed'],body:[move]}],[{kind:'start',body:[{type:'repeat',count:10,body:[set('distance',{sensor:{kind:'distance',port:2}}),wait(.1)]}]}]);
 const r=runParallel(b.data,{motorDriver:new ProfileMotors(),sensorRead:()=>15,maxTime:5000});assert.equal(r.stopped,false);assert.equal(r.tasks,0);assert.equal(r.sensorLog.length,10);assert.ok(r.sensorLog.every(s=>s.time<2000));
});

test('ramped movement samples effectful speed, turn and duration inputs exactly once',()=>{
 const value=v=>({callValue:{name:'value',args:[v]}}),procedures=[{name:'value',params:['v'],returns:true,result:{param:'v'},body:[{type:'change',var:'calls',value:1}]}];
 for(const mode of ['off','trapezoid','scurve'])for(const type of ['steering','tankFinite']){
  const command=type==='steering'?{type,turn:value(25),speed:value(40)}:{type,leftSpeed:value(40),rightSpeed:value(20)};
  const r=runParallel(build([set('calls',0),profile(mode),{...command,leftPort:8,rightPort:1,action:'time',seconds:value(1)}],procedures).data,{motorDriver:new ProfileMotors()});
  assert.equal(r.stopped,false,JSON.stringify({mode,type,events:r.events,calls:r.shared.getFloat32(0,true)}));assert.equal(r.shared.getFloat32(0,true),3,mode+' '+type);
 }
});

test('ramped movement rejects invalid runtime inputs before starting either selected motor',()=>{
 for(const value of [101,-101])for(const type of ['steering','tankFinite']){
  const unknown={sensor:{kind:'distance',port:2}},command=type==='steering'?{type,turn:25,speed:unknown}:{type,leftSpeed:20,rightSpeed:unknown};
  const r=runParallel(build([profile(),{...command,leftPort:2,rightPort:4,action:'time',seconds:1}]).data,{motorDriver:new ProfileMotors(),sensorRead:()=>value});
  assert.equal(r.stopped,true);assert.equal(r.events.some(e=>['motor','motorRun'].includes(e.type)),false);
 }
});

test('ramped movement applies each port stop behavior and preserves unrelated running output',()=>{
 for(const action of ['angle','time']){
  const b=build([{type:'motorRun',ports:1,speed:10},stopMode(2,'coast'),stopMode(4,'hold'),profile(),{type:'tankFinite',leftPort:2,rightPort:4,leftSpeed:30,rightSpeed:15,action,...(action==='angle'?{degrees:90}:{seconds:1})},wait(.2)]),motors=new ProfileMotors();
  const r=runParallel(b.data,{motorDriver:motors,maxTime:10000});assert.equal(r.stopped,false);assert.equal(r.tasks,0);assert.ok(motors.position[0]>0);
  const lastPerPort=r.events.filter(e=>e.type==='stop'&&[2,4].includes(e.ports)).slice(-2);assert.deepEqual(lastPerPort.map(e=>[e.ports,e.brake]),[[2,0],[4,1]]);
 }
});

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
