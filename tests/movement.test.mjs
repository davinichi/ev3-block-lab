import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../dist/ev3.js';
import {scanImage} from './helpers/image-scan.mjs';
import {runParallel} from './helpers/parallel-vm.mjs';
const setup=(leftPort=2,rightPort=4)=>({type:'movementSetup',leftPort,rightPort});
const run=(leftSpeed=20,rightSpeed=10)=>({type:'tank',movement:true,leftSpeed,rightSpeed});
const wait=seconds=>({type:'waitSeconds',seconds});
const build=(main,procedures=[],threads=[])=>{const b=compile({main,procedures,threads});scanImage(b.data);return b;};
const call=name=>({type:'call',name,args:[]});
const unknown={sensor:{kind:'touch',port:1}};

test('movement setup alone never starts motors; same ordered setup does not stop them',()=>{
 let r=runParallel(build([setup(),setup()]).data);
 assert.equal(r.events.filter(e=>['motorSync','motorRun','motor'].includes(e.type)).length,0);
 r=runParallel(build([setup(),run(),setup(),setup()]).data);
 const starts=r.events.filter(e=>e.type==='motorRun');assert.equal(starts.length,1);
 const stops=r.events.filter(e=>e.type==='stop');assert.deepEqual(stops.map(e=>e.ports),[15]);
});

test('every ordered pair selects the correct independent speeds without affecting other outputs',()=>{
 for(const left of [1,2,4,8])for(const right of [1,2,4,8])if(left!==right){
  const commands=[],driver={setSpeed:(ports,speed)=>commands.push([ports,speed]),startContinuous(){},stop(){},advance(){}};
  const b=build([setup(left,right),run(30,-15)]);runParallel(b.data,{motorDriver:driver});
  assert.deepEqual(commands,[[left,30],[right,-15]]);
 }
});

test('configuration change brakes the old pair before starting the new pair, including reversed order',()=>{
 const actions=[],driver={setSpeed:(ports,speed)=>actions.push(['speed',ports,speed]),startContinuous:ports=>actions.push(['start',ports]),stop:ports=>actions.push(['stop',ports])};
 runParallel(build([setup(),run(),setup(4,2),run(30,15),setup(1,8),run(-10,20)]).data,{motorDriver:driver});
 assert.deepEqual(actions,[['speed',2,20],['speed',4,10],['start',2],['start',4],['stop',6],['speed',4,30],['speed',2,15],['start',2],['start',4],['stop',6],['speed',1,-10],['speed',8,20],['start',1],['start',8],['stop',15]]);
});

test('all movement families compile with shared ports and retain directions, sync modes and geometry',()=>{
 for(const motion of [
  ...['forward','backward'].map(direction=>({type:'drive',direction,speed:20,cm:20,mode:'feedback'})),
  ...['spin','pivot'].flatMap(type=>['left','right'].map(direction=>({type,direction,speed:20,angle:90}))),
  ...['run','angle','time'].map(action=>({type:'steering',action,turn:25,speed:20,degrees:90,seconds:.2})),
  ...['angle','time'].map(action=>({type:'tankFinite',action,leftSpeed:30,rightSpeed:15,degrees:90,seconds:.2})),
  run()
 ]){
  const b=build([setup(8,1),{type:'wheel',diameter:56},{type:'tread',mm:112},{...motion,movement:true}]);
  const variant=b.program.main[3].variants[0];assert.equal(variant.leftPort,8);assert.equal(variant.rightPort,1);
  if(motion.type==='drive')assert.equal(variant.body[0].mode,'feedback');
  if(motion.type==='spin')assert.equal(variant.body[0].mode,'feedback');
  assert.ok(b.data.length<65536);
 }
});

test('preflight rejects absent, later, one-sided, zero-iteration and invalid wiring setup',()=>{
 const cases=[
  [run()], [run(),setup()],
  [{type:'if',condition:unknown,then:[setup()],else:[]},run()],
  [{type:'repeat',count:0,body:[setup()]},run()],
  [{type:'while',until:true,condition:unknown,body:[setup()]},run()],
  [setup(2,2),run()], [setup(0,4),run()]
 ];
 for(const main of cases)assert.throws(()=>build(main),/動き.*(?:設定|異なる)/);
 build([{type:'if',condition:unknown,then:[setup(2,4)],else:[setup(8,1)]},run()]);
 build([{type:'repeat',count:1,body:[setup()]},run()]);
});

test('My Block settings and early returns carry shared state only on guaranteed paths',()=>{
 const procedures=[{name:'設定',params:[],body:[setup(8,1)]},{name:'走行',params:[],body:[run()]}];
 const b=build([call('設定'),call('走行')],procedures),commands=[];
 runParallel(b.data,{motorDriver:{setSpeed:(p,s)=>commands.push([p,s]),startContinuous(){},stop(){},advance(){}}});
 assert.deepEqual(commands,[[8,20],[1,10]]);
 assert.throws(()=>build([call('走行'),call('設定')],procedures),/動きに使うモーターを設定/);
 const conditional={name:'条件設定',params:[],body:[{type:'if',condition:unknown,then:[{type:'myblockReturn'}],else:[]},setup()]};
 assert.throws(()=>build([call('条件設定'),run()],[conditional]),/動きに使うモーターを設定/);
 const neverCalled={name:'未使用',params:[],body:[setup()]};
 assert.throws(()=>build([run()],[neverCalled]),/動きに使うモーターを設定/);
});

test('parallel setup does not count as ordering assurance: runtime displays error 23 and stops',()=>{
 const b=build([run()],[],[{kind:'start',body:[wait(.5),setup()]}]);
 const r=runParallel(b.data);assert.equal(r.stopped,true);
 assert.equal(r.events.filter(e=>e.type==='motorRun').length,0);
 assert.ok(r.events.some(e=>e.type==='tone'&&e.frequency===300));
 assert.ok(r.events.some(e=>e.type==='draw'&&e.cmd===8&&e.args.includes(23)));
});

test('a new execution cannot inherit a previous run configuration; events and My Blocks share current wiring',()=>{
 const main=[{type:'if',condition:unknown,then:[setup(8,1)],else:[]},wait(.05),run()];
 const b=build(main,[],[{kind:'start',body:[wait(.1)]}]);
 let r=runParallel(b.data,{sensorRead:()=>1});assert.equal(r.stopped,false);assert.ok(r.events.some(e=>e.type==='motorRun'));
 r=runParallel(b.data,{sensorRead:()=>0});assert.equal(r.stopped,true);assert.ok(!r.events.some(e=>e.type==='motorRun'));
 const shared=build([setup(8,1),wait(.2)],[],[{kind:'start',body:[wait(.05),run()]}]);
 const commands=[];r=runParallel(shared.data,{motorDriver:{setSpeed:(p,s)=>commands.push([p,s]),startContinuous(){},stop(){},advance(){}}});
 assert.deepEqual(commands,[[8,20],[1,10]]);assert.equal(r.stopped,false);
});

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


test('shared wiring executes finite drive, spin, pivot, steering and tank on EV3 bytecode emulator',()=>{
 for(const [left,right]of [[2,4],[8,1],[4,2]])for(const direction of ['left','right']){
  const commands=[
   ...['forward','backward'].map(direction=>({type:'drive',direction,speed:20,cm:20,mode:'sync'})),
   {type:'spin',direction,speed:20,angle:90},{type:'pivot',direction,speed:20,angle:90},
   {type:'steering',action:'angle',turn:25,speed:20,degrees:90},{type:'steering',action:'time',turn:-25,speed:20,seconds:.2},
   {type:'tankFinite',action:'angle',leftSpeed:30,rightSpeed:15,degrees:90},{type:'tankFinite',action:'time',leftSpeed:-30,rightSpeed:15,seconds:.2}
  ];
  for(const command of commands){
   const b=build([setup(left,right),{type:'wheel',diameter:56},{type:'tread',mm:112},{...command,movement:true}]),motors=new Motors();
   const r=runParallel(b.data,{motorDriver:motors,maxTime:20000});assert.equal(r.tasks,0);assert.equal(r.stopped,false,JSON.stringify(command));
   const l=motors.position[Math.log2(left)],rr=motors.position[Math.log2(right)];
   if(command.type==='drive')assert.ok(Math.abs(l-(command.direction==='forward'?409:-409))<1&&Math.abs(l-rr)<1);
   if(command.type==='spin'){assert.ok(Math.abs(Math.abs(l)-180)<3&&Math.abs(Math.abs(rr)-180)<3);assert.equal(Math.sign(l),direction==='right'?1:-1);assert.equal(Math.sign(rr),-Math.sign(l));}
   if(command.type==='pivot'){assert.equal(direction==='right'?rr:l,0);assert.ok(Math.abs((direction==='right'?l:rr)-360)<1);}
   for(let i=0;i<4;i++)if(!((left|right)&(1<<i)))assert.equal(motors.position[i],0);
  }
 }
});
