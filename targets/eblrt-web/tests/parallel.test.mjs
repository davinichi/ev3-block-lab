import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../dist/ev3.js';
import {scanImage} from './helpers/image-scan.mjs';
import {runParallel} from './helpers/parallel-vm.mjs';
const wait=seconds=>({type:'waitSeconds',seconds});
const set=(name,value)=>({type:'set',var:name,value});
const change=(name,value)=>({type:'change',var:name,value});
const tone=frequency=>({type:'tone',frequency,volume:20,ms:50});
const send=(message,wait=false)=>({type:'broadcast',message,wait});
const loop=(count,body)=>({type:'repeat',count,body});
const start=body=>({kind:'start',body});
const receive=(message,body)=>({kind:'message',message,body});
const build=p=>{const b=compile({procedures:[],...p});scanImage(b.data);return b;};
const float=(b,result,name)=>{const names=[];const visit=x=>{if(!x||typeof x!=='object')return;if(typeof x.var==='string'&&!names.includes(x.var))names.push(x.var);for(const y of Object.values(x))visit(y);};visit(b.program);return result.shared.getFloat32(names.indexOf(name)*4,true);};
class Motors {
 time=0;position=[0,0,0,0];speed=[0,0,0,0];targets=[null,null,null,null];stops=[];
 start(ports,speed,degrees){for(let i=0;i<4;i++)if(ports&(1<<i)){this.speed[i]=speed;this.targets[i]=this.position[i]+Math.sign(speed)*degrees;}}
 startContinuous(ports,speed){this.start(ports,speed,Infinity);}
 setSpeed(ports,speed){for(let i=0;i<4;i++)if(ports&(1<<i))this.speed[i]=speed;}
 stop(ports){this.stops.push({ports,time:this.time});for(let i=0;i<4;i++)if(ports&(1<<i)){this.speed[i]=0;this.targets[i]=null;}}
 busy(ports){return this.targets.some((t,i)=>t!==null&&ports&(1<<i));}
 advance(ms){for(let i=0;i<4;i++)if(this.targets[i]!==null){const next=this.position[i]+this.speed[i]*ms/100;this.position[i]=this.speed[i]>0?Math.min(next,this.targets[i]):Math.max(next,this.targets[i]);if(this.position[i]===this.targets[i]){this.targets[i]=null;this.speed[i]=0;}}this.time+=ms;}
}

test('two native startup threads overlap; a short stack does not brake another moving stack',()=>{
 const b=build({main:[{type:'motorRun',ports:2,speed:20},wait(.2)],threads:[start([wait(.05)])]}),motors=new Motors();
 const result=runParallel(b.data,{motorDriver:motors});
 assert.ok(result.time>=200&&result.time<=205);assert.equal(result.tasks,0);assert.ok(motors.position[1]>=40);
 assert.ok(motors.stops.every(s=>s.time>=200));
 assert.deepEqual(b.objects.map(o=>o.trigger),[0,0,0]);
});
test('finite motor-ready waits yield to a separate sensor sampler on the brick',()=>{
 const b=build({main:[{type:'motor',ports:2,speed:20,degrees:100}],threads:[start([loop(5,[set('distance',{sensor:{kind:'distance',port:2}}),wait(.05)])])]}),motors=new Motors();
 const result=runParallel(b.data,{motorDriver:motors,sensorRead:({time})=>time<300?25:10});
 assert.equal(motors.position[1],100);assert.ok(result.sensorLog.length===5);
 assert.ok(result.sensorLog.every(s=>s.time<500));assert.ok(result.time>=500&&result.time<=505);
});
test('instruction-by-instruction scheduling does not lose concurrent shared-variable increments',()=>{
 const b=build({main:[loop(30,[change('count',1)])],threads:[start([loop(30,[change('count',1)])])]}),r=runParallel(b.data);
 assert.equal(float(b,r,'count'),60);assert.equal(r.tasks,0);
});
test('same My Block runs concurrently with independent arguments and local wait timers',()=>{
 const call=n=>({type:'call',name:'sum',args:[n]});
 const b=build({main:[call(2.5)],threads:[start([call(7.5)])],procedures:[{name:'sum',params:['n'],body:[wait(.1),change('total',{param:'n'})]}]}),r=runParallel(b.data);
 assert.equal(float(b,r,'total'),10);assert.ok(r.time<120);assert.equal(b.objects.filter(x=>x.kind==='procedure').length,2);
});
test('condition events fire on rising edges, including initial true, and do not repeat while held',()=>{
 const condition={sensor:{kind:'touch',port:1}};
 const b=build({main:[wait(.3),{type:'programEnd'}],threads:[{kind:'condition',condition,body:[change('presses',1)]}]}),r=runParallel(b.data,{sensorRead:({time})=>time<40||time>=120&&time<220?1:0});
 assert.equal(float(b,r,'presses'),2);assert.ok(r.stopped);
});
test('value-changed event uses an initial baseline and detects later changes only',()=>{
 const b=build({main:[wait(.2),{type:'programEnd'}],threads:[{kind:'changed',condition:{sensor:{kind:'color',port:3}},body:[change('changes',1)]}]}),r=runParallel(b.data,{sensorRead:({time})=>time<60?1:time<120?5:6});
 assert.equal(float(b,r,'changes'),2);
});
test('condition event can stop all threads and motors while another stack is blocked in a move',()=>{
 const b=build({main:[{type:'motor',ports:2,speed:20,degrees:1000},set('finished',1)],threads:[{kind:'condition',condition:{sensor:{kind:'touch',port:1}},body:[{type:'programEnd'}]}]}),motors=new Motors();
 const r=runParallel(b.data,{motorDriver:motors,sensorRead:({time})=>time>=100?1:0});
 assert.ok(r.stopped);assert.ok(motors.position[1]<1000);assert.equal(float(b,r,'finished'),0);assert.equal(motors.busy(15),false);
});
test('broadcast-and-wait joins all matching receivers and does not trigger other message names',()=>{
 const b=build({main:[send('測定',true),set('done',1),{type:'programEnd'}],threads:[receive('測定',[wait(.1),change('received',1)]),receive('測定',[wait(.2),change('received',1)]),receive('別',[change('wrong',1)])]}),r=runParallel(b.data);
 assert.equal(float(b,r,'received'),2);assert.equal(float(b,r,'wrong'),0);assert.equal(float(b,r,'done'),1);assert.ok(r.time>=200&&r.time<260);
});
test('nonblocking broadcast returns immediately; messages during a running handler coalesce for the next run',()=>{
 const b=build({main:[send('A'),wait(.04),send('A'),send('A'),wait(.26),{type:'programEnd'}],threads:[receive('A',[change('runs',1),wait(.1)])]}),r=runParallel(b.data);
 assert.equal(float(b,r,'runs'),2);assert.ok(r.stopped);
});
test('nested message waits work, but self and cyclic waits including My Blocks are rejected',()=>{
 const b=build({main:[send('A',true),{type:'programEnd'}],threads:[receive('A',[send('B',true),set('a',1)]),receive('B',[wait(.05),set('b',1)])]}),r=runParallel(b.data);
 assert.equal(float(b,r,'a'),1);assert.equal(float(b,r,'b'),1);
 assert.throws(()=>compile({main:[send('A')],procedures:[],threads:[receive('A',[send('A',true)])]}),/互い|自分/);
 assert.throws(()=>compile({main:[send('A')],procedures:[{name:'waitA',params:[],body:[send('A',true)]}],threads:[receive('A',[send('B',true)]),receive('B',[{type:'call',name:'waitA',args:[]}])]}),/互い|自分/);
});
test('CSV rows from simultaneous receivers are serialized and remain complete UTF-8 records',()=>{
 const record=(label,n)=>[loop(3,[{type:'logValue',label,value:n}])];
 const b=build({main:[{type:'logStart',file:'Parallel'},send('記録',true),{type:'logEnd'},{type:'programEnd'}],threads:[receive('記録',record('左',1.25)),receive('記録',record('右',2.5))]}),r=runParallel(b.data);
 const csv=new TextDecoder().decode(r.files.get('../prjs/EV3Lab/Parallel.csv'));
 const lines=csv.trim().split('\r\n');assert.equal(lines.length,7);assert.equal(lines.filter(l=>l.includes('"左","1.25"')).length,3);assert.equal(lines.filter(l=>l.includes('"右","2.5"')).length,3);
 assert.ok(lines.slice(1).every(l=>/^\d+\.\d{3},"[左右]","[\d.]+"$/.test(l)));
});
test('shared list appends and statistics stay valid across separate root-local My Block instances',()=>{
 const add={type:'call',name:'add',args:[]};
 const b=build({main:[loop(10,[add])],threads:[start([loop(10,[add])])],procedures:[{name:'add',params:[],body:[{type:'listAdd',list:'data',value:2},set('average',{listData:{op:'average',list:'data'}}),set('length',{listData:{op:'length',list:'data'}})]}]}),r=runParallel(b.data);
 assert.equal(float(b,r,'average'),2);assert.equal(float(b,r,'length'),20);
});
test('conflicting sensor modes across stacks are rejected while matching modes and different ports work',()=>{
 const sensor=(kind,port)=>set('s',{sensor:{kind,port}});
 assert.throws(()=>compile({main:[sensor('color',3)],procedures:[],threads:[start([sensor('reflected',3)])]}),/異なるモード/);
 build({main:[sensor('reflected',3)],threads:[start([sensor('reflected',3),sensor('color',4)])]});
});
test('event-only projects, absent receivers, nested geometry and resource limits have valid images',()=>{
 build({main:[],threads:[receive('go',[{type:'wheel',diameter:56},{type:'drive',ports:6,speed:20,cm:10,direction:'forward'}])]});
 const b=build({main:[send('nobody',true),tone(880)],threads:[start([wait(.01)])]});assert.equal(runParallel(b.data).events.filter(e=>e.type==='tone').length,1);
 assert.throws(()=>compile({main:[tone(880)],procedures:[],threads:Array.from({length:16},()=>start([wait(.1)]))}),/16個/);
});

test('gyro angle and rate run concurrently while a reset baseline is shared with event and My Block readers',()=>{
 const angle={sensor:{kind:'gyroAngle',port:1}},rate={sensor:{kind:'gyroRate',port:1}};
 const p={main:[{type:'gyroReset',port:1},send('開始',true),wait(.5)],threads:[receive('開始',[{type:'call',name:'計測',args:[]}]),{kind:'condition',condition:{op:'gte',left:angle,right:240},body:[tone(880),{type:'programEnd'}]}],procedures:[{name:'計測',params:[],body:[set('angle',angle),set('rate',rate)]}]};
 const b=build(p),result=runParallel(b.data,{sensorRead:({time})=>[100+time,25],maxTime:1000});
 assert.equal(float(b,result,'rate'),25);assert.ok(float(b,result,'angle')>=0&&float(b,result,'angle')<100);assert.ok(result.sensorLog.some(s=>s.time===float(b,result,'angle')));assert.ok(result.events.some(e=>e.type==='tone'&&e.frequency===880));assert.ok(result.sensorLog.every(s=>s.type===32&&s.mode===3));
 assert.throws(()=>compile({main:[{type:'gyroReset',port:1}],threads:[start([set('touch',{sensor:{kind:'touch',port:1}})])],procedures:[]}),/異なるモード/);
});
