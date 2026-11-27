import {expandedSource} from './ev3rt-source.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {exportEV3RT} from '../dist/ev3rt.js';
import {splitRuntimeC} from '../dist/ev3rt-c-modules.js';
const wait=ms=>({type:'wait',ms}),set=(name,value)=>({type:'set',var:name,value}),add=(name,value)=>({type:'change',var:name,value}),end={type:'programEnd'};
const gcc=process.platform==='win32'?'C:/cygwin64/bin/gcc.exe':'gcc';
const env={...process.env};if(process.platform==='win32'){const key=Object.keys(env).find(k=>k.toLowerCase()==='path')??'PATH';env[key]='C:\\cygwin64\\bin;'+env[key];}
const available=spawnSync(gcc,['--version'],{encoding:'utf8'}).status===0;
function run(program,checks,prepare=''){
 const dir=mkdtempSync(path.join(tmpdir(),'ev3rt-task-'));
 try{
  const built=exportEV3RT(program,{name:'Host'}),source=built.files['Host/app.c'];
  for(const [name,content]of Object.entries(built.files))writeFileSync(path.join(dir,path.basename(name)),content);
  const mock=splitRuntimeC(readFileSync(new URL('./fixtures/ev3rt-task-host.h',import.meta.url),'utf8'),'ev3api.h');
  writeFileSync(path.join(dir,'ev3api.h'),mock.header);
  writeFileSync(path.join(dir,'mock-api.c'),mock.implementation.replace('#include "ev3api.h"','#include "ev3api.h"\n#undef fopen'));
  writeFileSync(path.join(dir,'target_test.h'),'');
  const roots=(built.files['Host/app.h'].match(/extern void lab_task_/g)||[]).length;
  const dispatch=Array.from({length:roots},(_,i)=>`case LAB_TASK_${i}:lab_task_${i}(0);break;`).join('');
  writeFileSync(path.join(dir,'host.c'),`#include "app.c"\nstatic void *mock_worker(void *p){mock_id=(ID)(intptr_t)p;switch(mock_id){${dispatch}}return NULL;}\nER act_tsk(ID id){mock_created[id]=true;return pthread_create(&mock_threads[id],NULL,mock_worker,(void*)(intptr_t)id)==0?E_OK:E_OBJ;}\nint main(void){${prepare};main_task(0);${checks};puts("OK");return 0;}\n`);
  const bin=path.join(dir,process.platform==='win32'?'host.exe':'host');
  const compile=spawnSync(gcc,['-std=gnu99','-O1','-pthread','-I',dir,...['host.c','mock-api.c','ebl_rt_runtime.c','ebl_myblocks.c'].map(f=>path.join(dir,f)),'-lm','-o',bin],{encoding:'utf8',timeout:20000,env});
  assert.equal(compile.status,0,compile.stderr);
  const executed=spawnSync(bin,[],{encoding:'utf8',timeout:8000,env,cwd:dir});assert.equal(executed.status,0,executed.stderr||executed.error?.message);assert.match(executed.stdout,/OK/);
 }finally{rmSync(dir,{recursive:true,force:true});}
}

test('continuous steering repeated in a loop does not brake before final shutdown',{skip:!available},()=>{
 for(const threads of [[],[{kind:'start',body:[{type:'wait',ms:1}]}]])run({main:[{type:'movementSetup',leftPort:2,rightPort:4},{type:'repeat',count:4,body:[{type:'steering',movement:true,turn:0,speed:20,action:'run'},{type:'wait',ms:5}]}],threads,procedures:[]},'if(mock_brakes[1]!=1||mock_brakes[2]!=1||mock_steer_calls!=1){fprintf(stderr,"Unexpected brakes B=%d C=%d commands=%u",mock_brakes[1],mock_brakes[2],mock_steer_calls);return 57;}');
});
test('continuous steering restarts after sensor stop and applies speed/direction changes',{skip:!available},()=>{
 const steer=(speed=20,turn=0)=>({type:'steering',movement:true,action:'run',speed,turn});
 for(const threads of [[],[{kind:'start',body:[{type:'wait',ms:1}]}]])run({main:[{type:'movementSetup',leftPort:2,rightPort:4},steer(),{type:'stop',movement:true},steer(),steer(-20),steer(-20,50),steer(-20,50)],threads,procedures:[]},'if(mock_steer_calls!=4||lab_sync_run_power[1]!=-20||lab_sync_run_turn[1]!=50)return 58;');
});

test('changing continuous steering values does not brake the active pair',{skip:!available},()=>{
 const steer=(speed,turn)=>({type:'steering',movement:true,action:'run',speed,turn});
 for(const threads of [[],[{kind:'start',body:[wait(1)]}]])run({main:[{type:'movementSetup',leftPort:2,rightPort:4},steer(20,0),steer(20,10),steer(20,-10),steer(25,-10),steer(-20,10)],threads,procedures:[]},'if(mock_brakes[1]!=1||mock_brakes[2]!=1||mock_steer_calls!=5){fprintf(stderr,"Changing command brakes B=%d C=%d calls=%u",mock_brakes[1],mock_brakes[2],mock_steer_calls);return 59;}');
});

test('compiled PID formula preserves I and D terms using elapsed seconds',{skip:!available},()=>{
 const pid={pid:{name:'PID1',target:10,measured:8,kp:1,ki:.5,kd:.25}};
 run({main:[set('initial',pid)],threads:[{kind:'start',body:[wait(1)]}],procedures:[]},'lab_stopping=false;lab_pid_0.initialized=true;lab_pid_0.previous=2;lab_pid_0.integral=0;lab_pid_0.time=mock_now()-100000;SYSTIM before=lab_pid_0.time;float actual=lab_pid_compute(&lab_pid_0,10,9,1,.5,.25);float dt=((uint64_t)lab_pid_0.time/1000-(uint64_t)before/1000)/1000.0f;float expected=1+.5f*dt-.25f/dt;if(fabsf(actual-expected)>.0001f)return 60;');
});

test('PID derivative is retained while motor speeds saturate independently at both limits',{skip:!available},()=>{
 const pid={pid:{name:'PID1',target:{var:'goal'},measured:0,kp:.65,ki:1,kd:1}};
 for(const threads of [[],[{kind:'start',body:[wait(1)]}]])run({main:[set('goal',16),set('initial',pid),wait(2),set('goal',116),set('correction',pid),{type:'motorRun',ports:2,speed:{op:'add',left:50,right:{var:'correction'}}},{type:'motorRun',ports:4,speed:{op:'sub',left:50,right:{var:'correction'}}}],threads,procedures:[]},'if(fabsf(lab_var_2)<=150||mock_first[1]!=100||mock_first[2]!=-100){fprintf(stderr,"correction=%f B=%d C=%d",lab_var_2,mock_first[1],mock_first[2]);return 62;}');
});

test('compiled text preserves UTF-8, strict parsing, snapshots and list aggregates',{skip:!available},()=>{
 const txt={textVar:'名前'},ld=(op,extra={})=>({listData:{op,list:'測定',...extra}}),td=(op,value,other)=>({textData:{op,value,other}});
 run({main:[{type:'textSet',name:'名前',value:{text:'日本語'}},set('length',td('length',txt)),{type:'textSet',name:'文字',value:{textOp:'letter',value:txt,index:2}},set('match',td('equal',{textVar:'文字'},{text:'本'})),{type:'textSet',name:'結合',value:{textOp:'join',a:txt,b:{textOp:'number',value:1.5}}},set('number',td('number',{text:'-1.25e2'})),{type:'listAdd',list:'測定',value:5},{type:'listAdd',list:'測定',value:-2},{type:'listSet',list:'測定',index:1,value:8},set('average',ld('average')),set('min',ld('min')),{type:'listDelete',list:'測定',index:2},set('item',ld('item',{index:1}))],threads:[{kind:'start',body:[wait(1)]}],procedures:[]},'if(lab_var_0!=3||lab_var_1!=1||lab_var_2!=-125||lab_var_3!=3||lab_var_4!=-2||lab_var_5!=8||strcmp(lab_text_2.data,"日本語1.5"))return 40');
});

test('compiled shared list and text mutations stay coherent across tasks',{skip:!available},()=>{
 const body=[{type:'repeat',count:80,body:[{type:'listAdd',list:'L',value:1},{type:'textSet',name:'T',value:{text:'日本語'}}]}];
 run({main:body,threads:[{kind:'start',body}],procedures:[]},'lab_stopping=false;if(lab_list_0.count!=160||lab_list_read(&lab_list_0,3,0)!=160||strcmp(lab_text_0.data,"日本語"))return 41');
});

test('compiled PID uses seconds, caches same millisecond and resets stale state',{skip:!available},()=>{
 const pid={pid:{name:'制御',target:10,measured:2,kp:2,ki:1,kd:0}};
 run({main:[set('first',pid),wait(60),set('next',pid),{type:'pidReset',name:'制御'},set('reset',pid)],threads:[{kind:'start',body:[wait(1)]}],procedures:[]},'if(lab_var_0!=16||lab_var_1<16.4||lab_var_1>18||lab_var_2!=16)return 42;lab_stopping=false;lab_pid_0.time=mock_now()-61000000;lab_pid_0.integral=99;if(lab_pid_compute(&lab_pid_0,10,2,2,1,4)!=16||lab_pid_0.integral!=0)return 43');
});

test('compiled random, brick buttons, IR channel mapping and beacon absence',{skip:!available},()=>{
 const ir=(kind,channel)=>({sensor:{kind,port:1,channel}});
 // IR modes are sequential on one task, never concurrently switched by another root.
 run({main:[set('remote',ir('irRemote',2)),set('present',ir('irBeaconDetected',1)),set('missing',ir('irBeaconDetected',2)),set('distance',ir('irBeaconDistance',2)),set('heading',ir('irBeaconHeading',3)),set('up',{button:{id:1}}),set('any',{button:{id:7}}),set('down',{button:{id:3}}),set('random',{numeric:{op:'random',a:-3,b:3}})],threads:[{kind:'start',body:[wait(1)]}],procedures:[]},'if(lab_var_0!=6||lab_var_1!=1||lab_var_2!=0||lab_var_3!=100||lab_var_4!=12||lab_var_5!=1||lab_var_6!=1||lab_var_7!=0||lab_var_8< -3||lab_var_8>3)return 44;lab_stopping=false;unsigned seen=0;for(int i=0;i<500;++i){int v=lab_random(-3,3);if(v< -3||v>3)return 45;seen|=1U<<(v+3);}if(seen!=127||lab_random(4,4)!=4)return 46');
});

test('compiled CSV closes every row, quotes UTF-8 and neutralizes formulas',{skip:!available},()=>{
 run({main:[{type:'logStart',file:'Test'},{type:'logValue',label:'日本語,"項目"',value:{text:'=1+2'}},{type:'logValue',label:'number',value:-2.5},{type:'logEnd'}],threads:[{kind:'start',body:[wait(1)]}],procedures:[]},'FILE *fp=fopen("/EBL_Host_Test.csv","rb");if(!fp)return 47;char csv[1000]={0};fread(csv,1,999,fp);fclose(fp);if(!strstr(csv,"time_s,item,value\\r\\n")||!strstr(csv,"\\"日本語,\\"\\"項目\\"\\"\\",\\"\'=1+2\\"")||!strstr(csv,"\\"-2.5\\"")||lab_log_active||lab_log_rows!=2)return 48');
});

test('compiled flashing continues during waits and numeric display accepts negatives',{skip:!available},()=>{
 run({main:[{type:'led',color:1,mode:'flash'},{type:'displayNumber',value:-12.345,decimals:2,font:2,x:0,y:0},wait(620)],threads:[],procedures:[]},'if(mock_led_changes<3)return 49');
});

test('compiled data guards abort all tasks and release the semaphore',{skip:!available},()=>{
 for(const bad of [
  {type:'textSet',name:'T',value:{textOp:'join',a:{text:'a'.repeat(120)},b:{text:'b'}}},
  set('x',{textData:{op:'number',value:{text:' 12'}}}),
  set('x',{listData:{op:'average',list:'L'}}),
  {type:'listSet',list:'L',index:1,value:2},
  {type:'logValue',label:'x',value:1}
 ])run({main:[bad,set('after',1)],threads:[{kind:'start',body:[wait(40)]}],procedures:[]},'if(!lab_stopping||lab_contexts[0].depth||lab_contexts[1].depth)return 50');
});

test('HRP3 gyro angle/rate concurrent modes are rejected independently of EBL combined mode',()=>{
 const read=kind=>set('x',{sensor:{kind,port:1}});
 assert.throws(()=>exportEV3RT({main:[read('gyroAngle')],threads:[{kind:'start',body:[read('gyroRate')]}],procedures:[]}),/異なるモード/);
 assert.doesNotThrow(()=>exportEV3RT({main:[read('gyroAngle'),read('gyroRate')],procedures:[]}));
});
test('tasks define native HRP3 workers, shared semaphore and supervised shutdown',()=>{
 const p={main:[wait(1)],threads:[{kind:'condition',condition:1,body:[end]}],procedures:[]};
 const b=exportEV3RT(p),c=expandedSource(b);
 assert.match(b.files['EV3Lab/app.cfg'],/CRE_SEM\(LAB_SHARED_SEM/);
 assert.equal((b.files['EV3Lab/app.cfg'].match(/CRE_TSK/g)||[]).length,3);
 assert.match(c,/lab_contexts\[LAB_ROOT_COUNT\+1\]/);assert.match(c,/ter_tsk\(lab_task_ids\[i\]\)/);assert.match(c,/observed!=0 && previous==0/);
});
test('message wait cycles are rejected and unsupported event bodies cannot disappear',()=>{
 const p={main:[],threads:[{kind:'message',message:'x',body:[{type:'broadcast',message:'x',wait:true}]}],procedures:[]};
 assert.throws(()=>exportEV3RT(p),/互い|自分/);
 p.threads[0]={kind:'condition',condition:1,body:[{type:'led',color:1,mode:'pulse'}]};assert.throws(()=>exportEV3RT(p),/公開API/);
});
test('events and starts stay within 16 roots; event condition calls and sensor types are validated',()=>{
 const p={main:[wait(1)],threads:Array.from({length:15},()=>({kind:'start',body:[wait(1)]})),procedures:[]};
 assert.doesNotThrow(()=>exportEV3RT(p));p.threads.push({kind:'start',body:[]});assert.throws(()=>exportEV3RT(p),/16/);
 const bad={main:[],threads:[{kind:'changed',condition:{callValue:{name:'value',args:[]}},body:[]}],procedures:[{name:'value',params:[],returns:true,result:{sensor:{kind:'irRemote',port:1,channel:1}},body:[]}]};
 assert.doesNotThrow(()=>exportEV3RT(bad));
 bad.threads.push({kind:'condition',condition:{sensor:{kind:'infrared',port:1}},body:[]});assert.throws(()=>exportEV3RT(bad),/異なるモード/);
});
test('compiled native tasks serialize variable changes and stop after all starts finish',{skip:!available},()=>{
 run({main:[{type:'repeat',count:100,body:[add('x',1)]}],threads:[{kind:'start',body:[{type:'repeat',count:100,body:[add('x',1)]}]}],procedures:[]},'if(lab_var_0!=200) return 10');
});
test('separate My Block object returns multiple values through nested calls',{skip:!available},()=>{
 const program={main:[{type:'callOutputs',name:'pair',args:[3],targets:['a','b']},set('c',{callValue:{name:'nested',args:[5]}})],threads:[{kind:'start',body:[wait(1)]}],procedures:[
  {name:'pair',params:['v'],returns:true,results:[{param:'v'},{op:'mul',left:{param:'v'},right:2}],body:[]},
  {name:'nested',params:['v'],returns:true,result:{callValue:{name:'pair',args:[{param:'v'}],output:1}},body:[]}
 ]};
 run(program,'if(lab_var_0!=3||lab_var_1!=6||lab_var_2!=10)return 59;');
});
test('programEnd inside a separate My Block exits its owning task and stops other workers',{skip:!available},()=>{
 run({main:[{type:'call',name:'endNow',args:[]},set('after',1)],threads:[{kind:'start',body:[wait(500),set('late',1)]}],procedures:[{name:'endNow',params:[],body:[end]}]},'if(lab_var_0!=0||lab_var_1!=0||!lab_stopping)return 60;');
});
test('compiled condition event fires once per rising edge and programEnd stops workers',{skip:!available},()=>{
 run({main:[set('flag',1),wait(70),set('flag',0),wait(70),set('flag',1),wait(70),end],threads:[{kind:'condition',condition:{var:'flag'},body:[add('hits',1)]}],procedures:[]},'if(lab_var_1!=2) return 11');
});
test('compiled value-change event initializes its baseline and detects later changes',{skip:!available},()=>{
 run({main:[wait(60),set('value',1),wait(60),set('value',2),wait(60),end],threads:[{kind:'changed',condition:{var:'value'},body:[add('hits',1)]}],procedures:[]},'if(lab_var_1!=2) return 12');
});
test('compiled broadcast waits for every receiver and concurrent My Block locals stay separate',{skip:!available},()=>{
 run({main:[{type:'broadcast',message:'go',wait:true},set('finished',1),end],threads:[0,1].map(i=>({kind:'message',message:'go',body:[{type:'call',name:'work',args:[i+1]}]})),procedures:[{name:'work',params:['v'],body:[wait(30),add('sum',{param:'v'})]}]},'if(lab_var_0!=3 || lab_var_1!=1) return 13');
});
test('compiled event-only program can terminate and listeners outlive the start task',{skip:!available},()=>{
 run({main:[],threads:[{kind:'condition',condition:1,body:[set('x',1),end]}],procedures:[]},'if(lab_var_0!=1) return 14');
 run({main:[set('x',1)],threads:[{kind:'condition',condition:{var:'x'},body:[wait(60),set('done',1),end]}],procedures:[]},'if(lab_var_1!=1) return 15');
});
test('compiled competing drive commands stop every motor instead of racing',{skip:!available},()=>{
 run({main:[{type:'motorRun',ports:2,speed:20},wait(100)],threads:[{kind:'start',body:[wait(30),{type:'motorRun',ports:2,speed:-20}]}],procedures:[]},'if(!lab_stopping || mock_power[1]!=0) return 16');
});
test('compiled explicit stop cancels a finite move without stopping a newer owner',{skip:!available},()=>{
 run({main:[{type:'motorTimed',ports:2,speed:20,seconds:.3},set('continued',1),wait(100),end],threads:[{kind:'start',body:[wait(30),{type:'stop',ports:2},{type:'motorRun',ports:2,speed:-20},wait(200)]}],procedures:[]},'if(lab_var_0!=1 || mock_power[1]!=0) return 17');
});
test('compiled Back button shuts down waiting listeners and motors',{skip:!available},()=>{
 run({main:[{type:'motorRun',ports:2,speed:20}],threads:[{kind:'message',message:'never',body:[wait(1000)]}],procedures:[]},'if(!lab_stopping || mock_power[1]!=0 || mock_created[2] || mock_created[3]) return 18','mock_back_at=mock_now()+100000');
});
test('compiled zero-speed command can stop a different task motor and release ownership',{skip:!available},()=>{
 run({main:[{type:'motorRun',ports:2,speed:20},wait(100)],threads:[{kind:'start',body:[wait(30),{type:'motorRun',ports:2,speed:0},{type:'motorRun',ports:2,speed:-20},wait(30),{type:'stop',ports:2}]}],procedures:[]},'if(mock_power[1]!=0 || lab_contexts[0].depth || lab_contexts[1].depth) return 20');
});
test('compiled busy message handlers coalesce generations but acknowledge the final sender',{skip:!available},()=>{
 run({main:[{type:'broadcast',message:'go',wait:false},wait(20),{type:'broadcast',message:'go',wait:false},{type:'broadcast',message:'go',wait:true},end],threads:[{kind:'message',message:'go',body:[add('hits',1),wait(120)]}],procedures:[]},'if(lab_var_0!=2 || lab_ack[1]!=3) return 19');
});
test('compiled individual finite motors apply trapezoid and S-curve ramps to forward and reverse angles',{skip:!available},()=>{
 for(const mode of ['trapezoid','scurve'])run({main:[{type:'ramp',mode,upSeconds:.08,downSeconds:.08},{type:'motor',ports:2,speed:-25,degrees:90,mode:'independent'}],threads:[{kind:'start',body:[wait(10)]}],procedures:[]},'if(mock_counts[1]>-89 || mock_counts[1]<-94 || mock_first[1]!=-1 || mock_commands[1]<4) return 21','mock_rates[1]=20');
});
test('compiled pair feedback finishes both encoders with unequal motor response',{skip:!available},()=>{
 run({main:[{type:'motor',ports:6,speed:30,degrees:90,mode:'feedback'}],threads:[{kind:'start',body:[wait(10)]}],procedures:[]},'if(mock_counts[1]<89 || mock_counts[2]<89 || mock_counts[1]>94 || mock_counts[2]>94) return 22','mock_rates[1]=20;mock_rates[2]=12');
});
test('compiled stop defaults honor coast and software hold corrects a later displacement',{skip:!available},()=>{
 run({main:[{type:'stopMode',ports:2,mode:'coast'},{type:'motorTimed',ports:2,speed:20,seconds:.03}],threads:[{kind:'start',body:[wait(10)]}],procedures:[]},'if(!mock_coasts[1]) return 23');
 run({main:[{type:'stop',ports:2,stopMode:'hold'},wait(220),set('position',{sensor:{kind:'encoder',port:2}})],threads:[{kind:'start',body:[wait(10)]}],procedures:[]},'if(fabs(lab_var_0)>2 || mock_commands[1]<2) return 24','mock_rates[1]=30;mock_disturb_at=mock_now()+80000');
});
test('compiled speed updates change finite motion without losing its target',{skip:!available},()=>{
 run({main:[{type:'motor',ports:2,speed:20,degrees:90,mode:'independent'}],threads:[{kind:'start',body:[wait(50),{type:'motorSpeedSet',ports:2,speed:40}]}],procedures:[]},'if(mock_counts[1]<89 || mock_counts[1]>94 || mock_commands[1]<3) return 25','mock_rates[1]=20');
});
test('compiled raw L power can switch back to regulated speed and read measured speed',{skip:!available},()=>{
 run({main:[{type:'motorPower',ports:2,speed:20},wait(10),set('speed',{sensor:{kind:'motorSpeed',port:2}}),{type:'motorSpeedSet',ports:2,speed:30},wait(10)],threads:[{kind:'start',body:[wait(10)]}],procedures:[]},'if(lab_var_0!=20 || mock_modes[1]!=LARGE_MOTOR) return 26');
});
test('compiled hold survives encoder reset without moving to the old numerical count',{skip:!available},()=>{
 run({main:[{type:'motor',ports:2,speed:25,degrees:90,mode:'independent'},{type:'stop',ports:2,stopMode:'hold'},{type:'encoderReset',port:2},wait(120),set('position',{sensor:{kind:'encoder',port:2}})],threads:[],procedures:[]},'if(fabs(lab_var_0)>2) return 27','mock_rates[1]=30');
});
test('compiled sync speed change and finite reversal fail before later instructions',{skip:!available},()=>{
 run({main:[{type:'movementSetup',leftPort:2,rightPort:4},{type:'tank',movement:true,leftSpeed:20,rightSpeed:10},wait(120)],threads:[{kind:'start',body:[wait(30),{type:'motorSpeedSet',ports:2,speed:10},set('after',1)]}],procedures:[]},'if(lab_var_0!=0 || mock_power[1] || mock_power[2]) return 28');
 run({main:[{type:'motorTimed',ports:2,speed:20,seconds:.2}],threads:[{kind:'start',body:[wait(30),{type:'motorSpeedSet',ports:2,speed:-10},set('after',1)]}],procedures:[]},'if(lab_var_0!=0 || mock_power[1]) return 29');
});
test('compiled speed-only update of an idle motor never starts it',{skip:!available},()=>{
 run({main:[{type:'motorSpeedSet',ports:2,speed:20},wait(30),set('speed',{sensor:{kind:'motorSpeed',port:2}})],threads:[{kind:'start',body:[wait(10)]}],procedures:[]},'if(lab_var_0!=0 || mock_commands[1]) return 30');
});
