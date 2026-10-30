import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {compile,constant,local,packet,Framer,EV3Connection,u16,u32,decodeTimingRecord,programFileName,projectDirectory} from '../dist/ev3.js';

test('custom project folders constrain transfers and on-brick timing records to the same destination',async()=>{
  const project={main:[{type:'motor',ports:6,speed:20,degrees:360,mode:'feedback'}],procedures:[]};
  assert.equal(projectDirectory(),'../prjs/EV3Lab');
  const build=compile(project,'Class_3-A'),files=new Map();
  interpret(build.data,{files,motorDriver:new SimulatedMotors()});
  assert.match(build.diagnosticPath,/^\.\.\/prjs\/Class_3-A\/FB_[a-f0-9]{8}\.bin$/);
  const connection=new EV3Connection();
  connection.readFile=async path=>{assert.equal(path,build.diagnosticPath);return files.get(path);};
  const record=await connection.readTimingRecord(build.diagnosticPath,build.diagnosticTag);
  assert.deepEqual(record.degrees,[360,360]);
  let calls=0;connection.system=async(cmd,args)=>{calls++;assert.equal(cmd,0x9b);assert.equal(new TextDecoder().decode(new Uint8Array(args.slice(0,-1))),'../prjs/Class_3-A');return {status:0};};
  connection.writeFile=async(path,data)=>{assert.equal(path,'../prjs/Class_3-A/Run.rbf');assert.equal(data,build.data);};
  connection.readFile=async()=>build.data;
  assert.equal(await connection.transfer(build.data,'Run.rbf',()=>{},'Class_3-A'),'../prjs/Class_3-A/Run.rbf');
  assert.equal(calls,1);
  for(const folder of ['', '..', '../other', '日本語', 'x/y', 'a'.repeat(32)]){
    assert.throws(()=>compile(project,folder),/プロジェクト名/);
    await assert.rejects(connection.transfer(build.data,'Run.rbf',()=>{},folder),/プロジェクト名/);
  }
  assert.equal(calls,1,'invalid folders must fail before any communication');
});

test('program names preserve the requested basename and reject invalid paths before transfer',()=>{
  assert.equal(programFileName('Class1_test-2'),'Class1_test-2.rbf');
  assert.equal(programFileName('A'.repeat(31)),'A'.repeat(31)+'.rbf');
  for(const name of ['', 'A'.repeat(32), '../test', 'a/b', 'a\\b', 'test.rbf', 'a\0b', '名前', 'a b', null])assert.throws(()=>programFileName(name),/名前/);
});

test('transferring a changed program to the same name replaces and verifies the entire file',async()=>{
  const c=new EV3Connection(),files=new Map();let target='',received=[],cursor=0;
  c.system=async(cmd,args)=>{
    switch(cmd){
      case 0x9b:return {status:5,data:new Uint8Array()};
      case 0x92:target=new TextDecoder().decode(new Uint8Array(args.slice(4,-1)));received=[];return {status:0,data:new Uint8Array([1])};
      case 0x93:received.push(...args.slice(1));files.set(target,new Uint8Array(received));return {status:8,data:new Uint8Array([1])};
      case 0x94:cursor=new TextDecoder().decode(new Uint8Array(args.slice(2,-1)));return {status:8,data:new Uint8Array([...u32(files.get(cursor).length),1,...files.get(cursor)])};
      default:throw Error('Unexpected command');
    }
  };
  const name=programFileName('Class1');
  const first=compile(sound).data;
  const second=compile({main:[{type:'wait',ms:100}],procedures:[]}).data;
  const path=await c.transfer(first,name);
  assert.equal(await c.transfer(second,name),path);
  assert.equal(files.size,1);assert.deepEqual(files.get(path),second);
  assert.ok(second.length<first.length,'shorter replacement must leave no trailing bytes');
});

const sound={main:[{type:'call',name:'beep',args:[440]},{type:'wait',ms:500},{type:'call',name:'beep',args:[880]}],procedures:[{name:'beep',params:['frequency'],body:[{type:'tone',frequency:{param:'frequency'},ms:250,volume:25}]}]};
const dv=data=>new DataView(data.buffer,data.byteOffset,data.byteLength);
test('constants use signed EV3 primitive encodings',()=>{
  for(const [value,bytes] of [[0,[0]],[-1,[63]],[31,[31]],[-32,[32]],[32,[129,32]],[-100,[129,156]],[440,[130,184,1]],[-32769,[131,255,127,255,255]]])assert.deepEqual(constant(value),bytes);
  assert.deepEqual(local(0),[64]);assert.deepEqual(local(32),[193,32]);assert.deepEqual(local(128),[194,128,0]);assert.deepEqual(local(32768),[195,0,128,0,0]);assert.throws(()=>constant(1.5));
});
test('RBF has LEGO header, correct sizes, real SUBCALL and IN32 argument',()=>{
  const {data,objects}=compile(sound),v=dv(data);
  assert.equal(new TextDecoder().decode(data.slice(0,4)),'LEGO');assert.equal(v.getUint32(4,true),data.length);
  assert.equal(v.getUint16(8,true),104);assert.equal(v.getUint16(10,true),2);assert.equal(v.getUint32(12,true),0);
  assert.equal(v.getUint32(16,true),40);assert.equal(v.getUint16(22,true),0);assert.equal(v.getUint16(34,true),1);
  assert.equal(v.getUint32(28,true),40+objects[0].code.length);
  assert.deepEqual(objects[1].code,[1,0x82,0x94,1,25,0x40,0x82,250,0,0x96,8,10]);
  assert.deepEqual(objects[0].code.slice(0,6),[9,2,1,0x82,184,1]);
});

// A small independent VM for the subset produced by this compiler. It decodes
// bytes from the finished RBF, rather than reading the compiler's intermediate tree.
function interpret(bytes,{initialCounts=[0,0,0,0],movementLog=[],motorDriver=null,files=new Map(),sensorRead=()=>NaN,sensorType=null,sensorMode=null,motorTypes=[7,7,7,7],sensorLog=[],waitLimit=Infinity}={}){
  const handles=new Map();
  const counts=[...initialCounts],pendingSpeed=[0,0,0,0];
  const shared=dv(new Uint8Array(dv(bytes).getUint32(12,true)));
  const view=dv(bytes),headers=[];for(let i=0;i<view.getUint16(10,true);i++)headers.push({pc:view.getUint32(16+12*i,true),size:view.getUint32(24+12*i,true)});
  const encoderOffsets=[0,0,0,0];const events=[];let budget=500000,completedWaits=0;
  const execute=(id,args=[])=>{
    let pc=headers[id-1].pc;const memory=new Uint8Array(headers[id-1].size),own=dv(memory);
    const m=Object.fromEntries([8,16,32].flatMap(bits=>[['getInt'+bits,(at,...args)=>at<0?shared['getInt'+bits](-at-1,...args):own['getInt'+bits](at,...args)],['setInt'+bits,(at,...args)=>at<0?shared['setInt'+bits](-at-1,...args):own['setInt'+bits](at,...args)]]));
    if(id>1){const count=bytes[pc++];assert.equal(count,args.length);for(let i=0;i<count;i++){assert.ok([0x82,0x83].includes(bytes[pc++]));m.setInt32(i*4,args[i],true);}}
    function param(size=4,output=false){
      const tag=bytes[pc++];let val,isVar=false;
      if(tag===0x84){const start=pc;while(bytes[pc]!==0){assert.ok(pc<bytes.length);pc++;}const text=new TextDecoder().decode(bytes.slice(start,pc));pc++;return text;}
      if(tag&128){const n={1:1,2:2,3:4}[tag&7];assert.ok(n);val=n===1?view.getInt8(pc):n===2?view.getInt16(pc,true):view.getInt32(pc,true);pc+=n;isVar=!!(tag&64);if(isVar)val=val>>>0;}
      else if(tag&64){val=tag&31;isVar=true;}
      else val=(tag&32)?(tag&63)-64:tag&63;
      if(isVar && (tag&32))val=-val-1;
      if(output){assert.ok(isVar);return val;}
      if(isVar)return size===1?m.getInt8(val):size===2?m.getInt16(val,true):m.getInt32(val,true);
      return val;
    }
    const floatBits=new DataView(new ArrayBuffer(4));
    const fparam=()=>{floatBits.setInt32(0,param(),true);return floatBits.getFloat32(0,true);};
    const setFloat=(at,n)=>{floatBits.setFloat32(0,n,true);m.setInt32(at,floatBits.getInt32(0,true),true);};
    while(--budget>0){
      const op=bytes[pc++];
      switch(op){
        case 0x0a:case 0x08:return;
        case 9:{const target=param(2),count=param(1),args=[];for(let i=0;i<count;i++)args.push(param());execute(target,args);break;}
        case 0x94:{assert.equal(param(1),1);const volume=param(1),frequency=param(2),ms=param(2);events.push({type:'tone',volume,frequency,ms});break;}
        case 0x96:break;
        case 0x85:{const ms=param(),at=param(4,true);m.setInt32(at,(motorDriver?.time??0)+ms,true);events.push({type:'wait',ms});break;}
        case 0x86:{const deadline=param();if(motorDriver)motorDriver.advance(Math.max(0,deadline-motorDriver.time));if(++completedWaits>=waitLimit)throw Error('TEST_WAIT_LIMIT');break;}
        case 0x87:{const at=param(4,true);m.setInt32(at,motorDriver?.time??0,true);break;}
        case 0xae:{assert.equal(param(1),0);const ports=param(1),speed=param(1);assert.equal(param(),0);const degrees=param();assert.equal(param(),0);assert.equal(param(1),1);events.push({type:'motor',ports,speed,degrees});motorDriver?.start(ports,speed,degrees);break;}
        case 0xaf:{assert.equal(param(1),0);const ports=param(1),speed=param(1);assert.equal(param(),0);const ms=param();assert.equal(param(),0);assert.equal(param(1),1);events.push({type:'motorTimed',ports,speed,ms});break;}
        case 0xa5:{assert.equal(param(1),0);const ports=param(1),speed=param(1);for(let i=0;i<4;i++)if(ports&(1<<i))pendingSpeed[i]=speed;motorDriver?.setSpeed(ports,speed);break;}
        case 0xa6:{assert.equal(param(1),0);const ports=param(1),selected=[0,1,2,3].filter(i=>ports&(1<<i)),speed=pendingSpeed[selected[0]],different=selected.some(i=>pendingSpeed[i]!==speed);events.push({type:'motorRun',ports,speed,...(different?{speeds:selected.map(i=>({port:i,speed:pendingSpeed[i]}))}:{})});if(different)for(const i of selected)motorDriver?.startContinuous(1<<i,pendingSpeed[i]);else motorDriver?.startContinuous(ports,speed);break;}
        case 0xa9:{assert.equal(param(1),0);const ports=param(1),at=param(1,true);m.setInt8(at,motorDriver?.busy(ports)?1:0);break;}
        case 0xb3:{assert.equal(param(1),0);const port=param(1),at=param(4,true);m.setInt32(at,motorDriver?Math.round(motorDriver.position[port]-encoderOffsets[port]):counts[port],true);break;}
        case 0xb2:{assert.equal(param(1),0);const ports=param(1);for(let i=0;i<4;i++)if(ports&(1<<i)){if(motorDriver)encoderOffsets[i]=motorDriver.position[i];else counts[i]=0;}break;}
        case 0xa2:{assert.equal(param(1),0);const ports=param(1);for(let i=0;i<4;i++)if(ports&(1<<i))counts[i]=0;break;}
        case 0xb0:{assert.equal(param(1),0);const ports=param(1),speed=param(1),turn=param(2),degrees=param();assert.equal(param(1),1);events.push({type:'motorSync',ports,speed,turn,degrees});
          // Firmware sync compares the two accumulated TachoCnt values. In the
          // ideal equal-count end state, an old offset reduces physical travel.
          for(let i=0;i<4;i++)if(ports&(1<<i)){movementLog.push({port:i,degrees:Math.sign(speed)*degrees-counts[i]});counts[i]=0;}break;}
        case 0xaa:{param(1);const ports=param(1);if(motorDriver){let waits=0;while(motorDriver.busy(ports)){assert.ok(++waits<100000);motorDriver.advance(20);}}break;}
        case 0xa3:{param(1);const ports=param(1);param(1);motorDriver?.stop(ports);break;}
        case 0x02:{assert.equal(param(2),-1);if(motorDriver)motorDriver.aborted=true;throw Error('PROGRAM_STOP');}
        case 0xc0:{const command=param(1);
          if(command===2){const path=param(),at=param(2,true);files.set(path,new Uint8Array());handles.set(1,path);m.setInt16(at,1,true);}
          else if(command===29){const handle=param(2),length=param(2),source=param(1,true),path=handles.get(handle);assert.ok(path);assert.ok(source+length<=memory.length);files.set(path,new Uint8Array([...files.get(path),...memory.slice(source,source+length)]));}
          else if(command===7){const handle=param(2);assert.ok(handles.has(handle));handles.delete(handle);}
          else throw Error(`Unsupported FILE command ${command}`);break;}
        case 0x99:{const command=param(1);assert.equal(param(1),0);const port=param(1);
          if(command===29){const type=param(1),mode=param(1),count=param(1),sample={port:port+1,type,mode};assert.ok(count>=1&&count<=8);sensorLog.push(sample);const readings=sensorRead(sample);for(let i=0;i<count;i++){const at=param(4,true);m.setInt32(at,0,true);own.setFloat32(at,Array.isArray(readings)?readings[i]:readings,true);}}
          else if(command===5){const typeAt=param(1,true),modeAt=param(1,true);if(port>=16){assert.ok(port<=19);m.setInt8(typeAt,motorTypes[port-16]);m.setInt8(modeAt,0);}else{const last=sensorLog.at(-1);assert.equal(port+1,last.port);m.setInt8(typeAt,sensorType??last.type);m.setInt8(modeAt,sensorMode??last.mode);}}
          else throw Error(`Unexpected INPUT_DEVICE command ${command}`);break;}
        case 0x3e:{const n=fparam(),at=param(4,true);m.setInt32(at,Number.isNaN(n)?-2147483648:Math.min(2147483647,Math.max(-2147483647,Math.trunc(n))),true);break;}
        case 0x3b:{const n=param(),at=param(4,true);setFloat(at,n);break;}
        case 0x3f:{const n=fparam(),at=param(4,true);setFloat(at,n);break;}
        case 0x13:case 0x17:case 0x1b:case 0x1f:{const a=fparam(),b=fparam(),at=param(4,true);setFloat(at,op===0x13?a+b:op===0x17?a-b:op===0x1b?a*b:a/b);break;}
        case 0x8d:{const command=param(1),x=fparam();let y;if([2,20].includes(command))y=fparam();const at=param(4,true);
          const functions={1:Math.exp,2:()=>x%y,3:Math.floor,4:Math.ceil,6:Math.abs,8:Math.sqrt,9:Math.log10,10:Math.log,11:n=>Math.sin(n*Math.PI/180),12:n=>Math.cos(n*Math.PI/180),13:n=>Math.tan(n*Math.PI/180),14:n=>Math.asin(n)*180/Math.PI,15:n=>Math.acos(n)*180/Math.PI,16:n=>Math.atan(n)*180/Math.PI,20:()=>x**y};assert.ok(functions[command]);setFloat(at,functions[command](x));break;}
        case 0x47:case 0x4b:case 0x4f:case 0x53:case 0x57:case 0x5b:{const a=fparam(),b=fparam(),at=param(1,true),compare={0x47:a<b,0x4b:a>b,0x4f:a===b,0x53:a!==b,0x57:a<=b,0x5b:a>=b};m.setInt8(at,+compare[op]);break;}
        case 0x67:case 0x6b:{const a=fparam(),b=fparam(),jump=param();if(op===0x67?a<b:a>b)pc+=jump;break;}
        case 0x3a:{const n=param(),at=param(4,true);m.setInt32(at,n,true);break;}
        case 0x12:{const a=param(),b=param(),at=param(4,true);m.setInt32(at,a+b,true);break;}
        case 0x16:{const a=param(),b=param(),at=param(4,true);m.setInt32(at,a-b,true);break;}
        case 0x1a:{const a=param(),b=param(),at=param(4,true);m.setInt32(at,Math.imul(a,b),true);break;}
        case 0x1e:{const a=param(),b=param(),at=param(4,true);assert.notEqual(b,0);m.setInt32(at,Math.trunc(a/b),true);break;}
        case 0x22:case 0x26:{const a=param(),b=param(),at=param(4,true);m.setInt32(at,op===0x22?a|b:a&b,true);break;}
        case 0x46:case 0x4a:case 0x4e:case 0x52:case 0x56:case 0x5a:{const a=param(),b=param(),at=param(1,true);const compare={0x46:a<b,0x4a:a>b,0x4e:a===b,0x52:a!==b,0x56:a<=b,0x5a:a>=b};m.setInt8(at,+compare[op]);break;}
        case 0x66:{const a=param(),b=param(),jump=param();if(a<b)pc+=jump;break;}
        case 0x6a:{const a=param(),b=param(),jump=param();if(a>b)pc+=jump;break;}
        case 0x40:{const jump=param();pc+=jump;break;}
        default:throw Error(`Unexpected opcode ${op} at ${pc-1}`);
      }
    }
    throw Error('VM budget exceeded');
  };
  try{execute(1);}catch(e){if(e.message!=='PROGRAM_STOP'&&!(Number.isFinite(waitLimit)&&e.message==='TEST_WAIT_LIMIT'))throw e;}return events;
}

// Simplified unequal-response motors, not a physical EV3 emulator. The tests
// run the generated RBF (including its control loop) against this model.
class SimulatedMotors{
  constructor(gains=[1,1,.7,1],position=[0,0,0,0]){this.gains=gains;this.position=[...position];this.time=0;this.active=[false,false,false,false];this.speed=[0,0,0,0];this.target=[0,0,0,0];this.finished=[null,null,null,null];this.commands=[];}
  start(ports,speed,degrees){for(let i=0;i<4;i++)if(ports&(1<<i)){this.speed[i]=speed;this.active[i]=true;this.target[i]=this.position[i]+Math.sign(speed)*degrees;this.finished[i]=null;}}
  startContinuous(ports,speed){for(let i=0;i<4;i++)if(ports&(1<<i)){this.speed[i]=speed;this.active[i]=true;this.target[i]=Math.sign(speed)*Infinity;}}
  setSpeed(ports,speed){assert.ok(Math.abs(speed)<=100);this.commands.push({ports,speed,time:this.time});for(let i=0;i<4;i++)if(ports&(1<<i))this.speed[i]=speed;}
  busy(ports){return this.active.some((a,i)=>a && (ports&(1<<i)));}
  stop(ports){for(let i=0;i<4;i++)if(ports&(1<<i))this.active[i]=false;}
  advance(ms){for(let i=0;i<4;i++)if(this.active[i]){
    const velocity=this.speed[i]*this.gains[i]*.01;const step=velocity*ms,remaining=this.target[i]-this.position[i];
    if(Math.abs(remaining)<1e-9 || (Math.abs(step)+1e-9>=Math.abs(remaining) && velocity*remaining>0)){this.position[i]=this.target[i];this.active[i]=false;this.finished[i]=this.time+(velocity?remaining/velocity:0);}
    else this.position[i]+=step;
  }this.time+=ms;}
}

test('standalone progress feedback reduces finishing-time gap without reducing either angle',()=>{
  const p={main:[{type:'motor',ports:6,speed:20,degrees:360,mode:'independent'}],procedures:[]};
  const independent=new SimulatedMotors();interpret(compile(p).data,{motorDriver:independent});
  const oldGap=Math.abs(independent.finished[1]-independent.finished[2]);assert.ok(oldGap>700);
  p.main[0].mode='feedback';const feedback=new SimulatedMotors();interpret(compile(p).data,{motorDriver:feedback});
  const gap=Math.abs(feedback.finished[1]-feedback.finished[2]);
  assert.deepEqual(feedback.position.slice(1,3),[360,360]);assert.ok(gap<100,`gap=${gap} ms`);assert.ok(gap<oldGap/5);
  assert.equal(feedback.aborted,undefined);assert.ok(feedback.commands.some(x=>x.ports===2 && x.speed<20));
});

test('feedback works inside a My Block, with reverse travel and old sensor counts',()=>{
  const p={main:[{type:'call',name:'move',args:[360,-20]}],procedures:[{name:'move',params:['angle','speed'],body:[{type:'motor',ports:6,speed:{param:'speed'},degrees:{param:'angle'},mode:'feedback'}]}]};
  const driver=new SimulatedMotors([1,.6,1,1],[0,120,-70,0]);interpret(compile(p).data,{motorDriver:driver});
  assert.deepEqual(driver.position.slice(1,3),[-240,-430]);assert.ok(Math.abs(driver.finished[1]-driver.finished[2])<100);
  assert.ok(driver.commands.every(x=>x.speed<=0 && x.speed>=-20));
});

test('feedback watchdog stops all motors and exits the whole program when one cannot move',()=>{
  const p={main:[{type:'motor',ports:6,speed:20,degrees:360,mode:'feedback'},{type:'motor',ports:1,speed:20,degrees:90}],procedures:[]};
  const driver=new SimulatedMotors([1,1,0,1]);interpret(compile(p).data,{motorDriver:driver});
  assert.equal(driver.aborted,true);assert.equal(driver.busy(15),false);assert.equal(driver.position[0],0);assert.equal(driver.position[2],0);assert.ok(driver.time>=14000 && driver.time<=14100);
});

test('feedback maintains both finite targets over multiple motor response ratios',()=>{
  for(const gains of [[1,1,.5,1],[1,.5,1,1],[1,1,.9,1]]){
    const driver=new SimulatedMotors(gains);
    interpret(compile({main:[{type:'motor',ports:6,speed:20,degrees:360,mode:'feedback'}],procedures:[]}).data,{motorDriver:driver});
    assert.deepEqual(driver.position.slice(1,3),[360,360]);assert.ok(Math.abs(driver.finished[1]-driver.finished[2])<120);assert.equal(driver.aborted,undefined);
  }
  assert.throws(()=>compile({main:[{type:'motor',ports:6,speed:1,degrees:36000,mode:'feedback'}],procedures:[]}),/監視時間/);
});

test('on-brick report preserves per-port finish times and 25/50/75 percent milestones',()=>{
  const p={main:[{type:'motor',ports:6,speed:20,degrees:360,mode:'feedback'}],procedures:[]};
  const compiled=compile(p),driver=new SimulatedMotors(),files=new Map();
  interpret(compiled.data,{motorDriver:driver,files});
  const bytes=files.get(compiled.diagnosticPath);assert.equal(bytes.length,68);
  const report=decodeTimingRecord(bytes,compiled.diagnosticTag);
  assert.deepEqual(report.ports,['B','C']);assert.deepEqual(report.degrees,[360,360]);assert.equal(report.timedOut,false);
  assert.equal(report.deltaMs,report.stopMs[1]-report.stopMs[0]);
  for(let i=0;i<2;i++){
    assert.ok(report.stopMs[i]>=driver.finished[i+1]);assert.ok(report.stopMs[i]-driver.finished[i+1]<=20);
    const milestones=report.checkpoints.map(x=>x.ms[i]);assert.ok(milestones.every(n=>n>=0 && n<report.stopMs[i]));assert.ok(milestones[0]<=milestones[1] && milestones[1]<=milestones[2]);
  }
  assert.throws(()=>decodeTimingRecord(bytes,compiled.diagnosticTag^1),/一致/);
  assert.throws(()=>decodeTimingRecord(bytes.slice(0,64),compiled.diagnosticTag),/形式/);
});

test('watchdog diagnostic distinguishes an unfinished motor from a successful stop',()=>{
  const compiled=compile({main:[{type:'motor',ports:6,speed:20,degrees:360,mode:'feedback'}],procedures:[]});
  const driver=new SimulatedMotors([1,1,0,1]),files=new Map();interpret(compiled.data,{motorDriver:driver,files});
  const report=decodeTimingRecord(files.get(compiled.diagnosticPath),compiled.diagnosticTag);
  assert.equal(report.timedOut,true);assert.equal(report.stopMs[1],-1);assert.equal(report.deltaMs,null);assert.equal(report.degrees[1],0);
});

test('timing diagnostic reads the generated on-brick file through the EV3 system protocol',async()=>{
  const compiled=compile({main:[{type:'motor',ports:6,speed:20,degrees:360,mode:'feedback'}],procedures:[]});
  const files=new Map();interpret(compiled.data,{motorDriver:new SimulatedMotors(),files});
  const data=files.get(compiled.diagnosticPath),connection=new EV3Connection();
  connection.request=async(type,payload)=>{assert.equal(type,1);assert.equal(payload[0],0x94);return packet(1,3,[0x94,8,...u32(data.length),4,...data]);};
  const report=await connection.readTimingRecord(compiled.diagnosticPath,compiled.diagnosticTag);assert.deepEqual(report.degrees,[360,360]);assert.equal(report.timedOut,false);
  await assert.rejects(connection.readTimingRecord('../prjs/other.bin',compiled.diagnosticTag),/補正モード/);
});
test('standalone binary calls the same procedure with different arguments',()=>{
  assert.deepEqual(interpret(compile(sound).data),[{type:'tone',volume:25,frequency:440,ms:250},{type:'wait',ms:500},{type:'tone',volume:25,frequency:880,ms:250}]);
});
test('motor subroutine supports negative speed and independent 32-bit angle',()=>{
  const p={main:[{type:'call',name:'turn',args:[90,20]},{type:'call',name:'turn',args:[720,-30]}],procedures:[{name:'turn',params:['angle','speed'],body:[{type:'motor',ports:2,speed:{param:'speed'},degrees:{param:'angle'}}]}]};
  assert.deepEqual(interpret(compile(p).data),[{type:'motor',ports:2,speed:20,degrees:90},{type:'motor',ports:2,speed:-30,degrees:720}]);
});

test('B+C emits one EV3 STEP_SYNC with TURN=0 then waits on both ports',()=>{
  const p={main:[{type:'motor',ports:6,speed:20,degrees:360,mode:'sync'}],procedures:[]};
  const {data,objects}=compile(p);
  assert.deepEqual(objects[0].code.slice(0,15),[0xa2,0,6,0xb0,0,6,20,0,0x82,0x68,1,1,0xaa,0,6]);
  assert.deepEqual(interpret(data),[{type:'motorSync',ports:6,speed:20,turn:0,degrees:360}]);
});

test('all six port pairs synchronize forward and reverse with fresh relative angles',()=>{
 for(const ports of [3,5,9,6,10,12])for(const speed of [20,-20]){
  const movementLog=[],data=compile({main:[{type:'motor',ports,speed,degrees:360,mode:'sync'}],procedures:[]}).data;
  assert.deepEqual(interpret(data,{initialCounts:[-120,40,90,-30],movementLog}),[{type:'motorSync',ports,speed,turn:0,degrees:360}]);
  assert.deepEqual(movementLog,[0,1,2,3].filter(i=>ports&(1<<i)).map(port=>({port,degrees:Math.sign(speed)*360})));
 }
});

test('individual port stop brakes only the selected motor while other ports keep running',()=>{
 for(const selected of [1,2,4,8]){
  class StopDriver extends SimulatedMotors{constructor(){super([1,1,1,1]);this.stops=[];}stop(ports){super.stop(ports);this.stops.push({ports,time:this.time,active:[...this.active]});}}
  const driver=new StopDriver(),main=[1,2,4,8].map(ports=>({type:'motorRun',ports,speed:20}));
  main.push({type:'waitSeconds',seconds:1},{type:'stop',ports:selected},{type:'waitSeconds',seconds:1});
  interpret(compile({main,procedures:[]}).data,{motorDriver:driver});
  assert.deepEqual(driver.position,[1,2,4,8].map(p=>p===selected?200:400));
  assert.deepEqual(driver.stops[0],{ports:selected,time:1000,active:[1,2,4,8].map(p=>p!==selected)});
  assert.equal(driver.busy(15),false);assert.equal(driver.stops.at(-1).ports,15);
 }
});

test('legacy all-stop retains all ports and invalid explicit stop masks are rejected',()=>{
 const legacy=compile({main:[{type:'stop'}],procedures:[]});assert.deepEqual(legacy.objects[0].code.slice(0,4),[0xa3,0,15,1]);
 for(const ports of [0,16,-1,1.5,null])assert.throws(()=>compile({main:[{type:'stop',ports}],procedures:[]}),/停止するモーターポート/);
});

test('paired M timed and continuous commands target the selected ports and retain signed speed',()=>{
 for(const ports of [3,5,9,6,10,12])for(const speed of [25,-25]){
  const data=compile({main:[{type:'motorTimed',ports,speed,seconds:1.25},{type:'motorRun',ports,speed},{type:'waitSeconds',seconds:1}],procedures:[]}).data;
  assert.deepEqual(interpret(data),[{type:'motorTimed',ports,speed,ms:1250},{type:'motorRun',ports,speed},{type:'wait',ms:1000}]);
 }
 for(const ports of [7,11,13,14,15])assert.throws(()=>compile({main:[{type:'motorTimed',ports,speed:20,seconds:1}],procedures:[]}),/2個まで/);
});

test('all six port pairs apply progress feedback only to selected motors',()=>{
 for(const ports of [3,5,9,6,10,12])for(const speed of [20,-20]){
  const selected=[0,1,2,3].filter(i=>ports&(1<<i)),gains=[1,1,1,1],initial=[120,-40,90,-30];gains[selected[1]]=.7;
  const driver=new SimulatedMotors(gains,initial);
  interpret(compile({main:[{type:'motor',ports,speed,degrees:360,mode:'feedback'}],procedures:[]}).data,{motorDriver:driver});
  for(let i=0;i<4;i++)assert.equal(driver.position[i],initial[i]+(selected.includes(i)?Math.sign(speed)*360:0));
  assert.ok(Math.abs(driver.finished[selected[0]]-driver.finished[selected[1]])<100);
  assert.ok(driver.commands.every(c=>(c.ports&ports)===c.ports));assert.equal(driver.aborted,undefined);
 }
});

test('paired motors retain variable angle and signed speed in a My Block',()=>{
  const p={main:[{type:'call',name:'pair',args:[360,30]},{type:'call',name:'pair',args:[720,-30]}],procedures:[{name:'pair',params:['angle','speed'],body:[{type:'motor',ports:6,speed:{param:'speed'},degrees:{param:'angle'},mode:'sync'}]}]};
  assert.deepEqual(interpret(compile(p).data),[{type:'motorSync',ports:6,speed:30,turn:0,degrees:360},{type:'motorSync',ports:6,speed:-30,turn:0,degrees:720}]);
});

test('B+C rotates both shafts a fresh 360 degrees with a preexisting 90-degree offset',()=>{
  const p={main:[{type:'motor',ports:6,speed:20,degrees:360,mode:'sync'}],procedures:[]};
  const movementLog=[];
  interpret(compile(p).data,{initialCounts:[0,0,90,0],movementLog});
  assert.deepEqual(movementLog,[{port:1,degrees:360},{port:2,degrees:360}]);
});

test('reverse B+C movement also ignores unequal old encoder counts',()=>{
  const p={main:[{type:'motor',ports:6,speed:-20,degrees:360,mode:'sync'}],procedures:[]};
  const movementLog=[];
  interpret(compile(p).data,{initialCounts:[0,-180,90,0],movementLog});
  assert.deepEqual(movementLog,[{port:1,degrees:-360},{port:2,degrees:-360}]);
});

test('three or four ports cannot be passed to the two-motor sync operation',()=>{
  for(const ports of [7,11,13,14,15])assert.throws(()=>compile({main:[{type:'motor',ports,speed:20,degrees:360}],procedures:[]}),/2個まで/);
});

test('default B+C uses independent angle targets; synchronization must be explicitly requested',()=>{
  const p={main:[{type:'motor',ports:6,speed:20,degrees:360}],procedures:[]};
  assert.deepEqual(interpret(compile(p).data),[{type:'motor',ports:6,speed:20,degrees:360}]);
  p.main[0].mode='unknown';assert.throws(()=>compile(p),/制御方式/);
});

test('motor diagnostics reads signed B/C sensor counts without movement or reset commands',async()=>{
  const c=new EV3Connection();
  c.request=async(type,payload)=>{
    assert.equal(type,0);assert.deepEqual(payload,[8,0,0xb3,0,1,0x60,0xb3,0,2,0x64]);
    return packet(1,2,[...u32(-361),...u32(240)]);
  };
  assert.deepEqual(await c.readMotorCounts(),{B:-361,C:240});
  c.request=async()=>packet(1,4,[]);await assert.rejects(c.readMotorCounts(),/読み取り/);
  c.request=async()=>packet(1,2,[0,0]);await assert.rejects(c.readMotorCounts(),/読み取り/);
});
test('nested loops and subcalls use separate local memory; zero loops skip',()=>{
  const p=structuredClone(sound);p.main=[{type:'repeat',count:0,body:[{type:'call',name:'beep',args:[440]}]},{type:'repeat',count:2,body:[{type:'repeat',count:3,body:[{type:'call',name:'beep',args:[880]}]}]}];
  const events=interpret(compile(p).data);assert.equal(events.length,6);assert.ok(events.every(e=>e.frequency===880));
});
test('invalid inputs and recursion fail before file generation',()=>{
  for(const speed of [0,101,-101,1.5])assert.throws(()=>compile({main:[{type:'motor',ports:2,speed,degrees:90}],procedures:[]}));
  const p=structuredClone(sound);p.procedures[0].body=[{type:'call',name:'beep',args:[440]}];assert.throws(()=>compile(p),/再帰/);
  assert.throws(()=>compile({main:[{type:'call',name:'absent',args:[]}],procedures:[]}),/定義/);
  assert.throws(()=>compile({main:[{type:'wait',ms:{param:'x'}}],procedures:[]}),/引数/);
});
test('framer handles fragmented frames and coalesced replies',()=>{
  const a=packet(7,3,[0x92,0,1]),b=packet(8,3,[0x93,8,1]);const result=[];const f=new Framer(x=>result.push(x));
  const stream=new Uint8Array([...a,...b]);for(const v of stream)f.push([v]);assert.deepEqual(result,[a,b]);
  const all=[];new Framer(x=>all.push(x)).push(stream);assert.deepEqual(all,[a,b]);
  assert.throws(()=>new Framer(()=>{}).push([255,255]),/長さ/);
});
test('system command checks counter-correlated reply, status and opcode',async()=>{
  const c=new EV3Connection();c.request=async()=>packet(1,3,[0x92,5]);await assert.rejects(c.system(0x92),/許可/);
  c.request=async()=>packet(1,3,[0x93,0]);await assert.rejects(c.system(0x92),/一致/);
});
test('multi-packet transfer reads back all bytes and only then succeeds',async()=>{
  const c=new EV3Connection();const data=new Uint8Array(730).map((_,i)=>i%251);let saved=[],cursor=0;const seen=[];
  c.system=async(cmd,args)=>{seen.push(cmd);switch(cmd){
    case 0x9b:return {status:7,data:new Uint8Array()};
    case 0x92:assert.equal(dv(new Uint8Array(args)).getUint32(0,true),730);return {status:0,data:new Uint8Array([9])};
    case 0x93:assert.equal(args[0],9);saved.push(...args.slice(1));return {status:saved.length===data.length?8:0,data:new Uint8Array([9])};
    case 0x94:cursor=240;return {status:0,data:new Uint8Array([...u32(saved.length),9,...saved.slice(0,240)])};
    case 0x95:{const chunk=saved.slice(cursor,cursor+240);cursor+=chunk.length;return {status:cursor===saved.length?8:0,data:new Uint8Array([9,...chunk])};}
    default:throw Error('unexpected command');
  }};
  assert.equal(await c.transfer(data,'test.rbf'),'../prjs/EV3Lab/test.rbf');assert.deepEqual(saved,Array.from(data));assert.equal(seen.filter(n=>n===0x93).length,4);
  c.readFile=async()=>new Uint8Array(data.length);await assert.rejects(c.transfer(data,'test.rbf'),/照合/);
});
test('readback closes an exact-multiple file handle with final EOF read',async()=>{
  const c=new EV3Connection();let called=0;c.system=async cmd=>{called++;return cmd===0x94?{status:0,data:new Uint8Array([...u32(240),3,...new Uint8Array(240)])}:{status:8,data:new Uint8Array([3])};};
  assert.equal((await c.readFile('test')).length,240);assert.equal(called,2);
});

test('a second transfer succeeds when firmware returns NO_PERMISSION for an existing directory',async()=>{
  const c=new EV3Connection();const data=compile(sound).data;let directoryExists=false,saved=[];let count=0;
  c.request=async(type,payload)=>{
    assert.equal(type,1);const [cmd,...args]=payload;let status=0,result=[];
    switch(cmd){
      case 0x9b: status=directoryExists?5:0;directoryExists=true;break;
      case 0x92: saved=[];result=[2];break;
      case 0x93: saved.push(...args.slice(1));status=8;result=[2];break;
      case 0x94: status=8;result=[...u32(saved.length),2,...saved];break;
      default: throw Error(`Unexpected command ${cmd}`);
    }
    return packet(++count,status===5?5:3,[cmd,status,...result]);
  };
  assert.equal(await c.transfer(data,'first.rbf'),'../prjs/EV3Lab/first.rbf');
  assert.equal(await c.transfer(data,'second.rbf'),'../prjs/EV3Lab/second.rbf');
  assert.deepEqual(saved,Array.from(data));
});

test('real write denial after directory creation failure still fails without readback or success',async()=>{
  const c=new EV3Connection(),seen=[];
  c.request=async(type,payload)=>{seen.push(payload[0]);return packet(1,5,[payload[0],5]);};
  await assert.rejects(c.transfer(compile(sound).data,'denied.rbf'),/許可/);
  assert.deepEqual(seen,[0x9b,0x92]);
});
test('request registers before write, ignores foreign counter and fails on timeout',async()=>{
  const c=new EV3Connection();c.port={};c.close=async()=>{c.closing=true;};
  c.writer={write:async bytes=>{c.receive(packet(999,3,[0x92,0,1]));c.receive(packet(bytes[2]+256*bytes[3],3,[0x92,0,1]));}};
  assert.equal((await c.system(0x92)).data[0],1);
  c.writer={write:async()=>{}};await assert.rejects(c.request(1,[0x92],10),/応答がありません/);assert.equal(c.pending.size,0);assert.equal(c.closing,true);
});

test('opcode assignments and header macros agree with canonical firmware definitions',t=>{
  if(!existsSync('../ev3-reference/ev3sources/lms2012/lms2012/source/bytecodes.h')){t.skip('Optional canonical firmware checkout is not bundled.');return;}
  const source=readFileSync('../ev3-reference/ev3sources/lms2012/lms2012/source/bytecodes.h','utf8');
  for(const [name,value] of [['opOUTPUT_START','A6'],['opINPUT_DEVICE','99'],['opMOVEF_32','3E'],['opCALL','09'],['opOUTPUT_STEP_SPEED','AE'],['opTIMER_WAIT','85'],['opJR_LT32','66'],['opSOUND_READY','96'],['opOUTPUT_SPEED','A5'],['opOUTPUT_TEST','A9'],['opOUTPUT_GET_COUNT','B3'],['opADD32','12'],['opMUL32','1A'],['opDIV32','1E'],['opJR_GT32','6A'],['opTIMER_READ','87'],['opPROGRAM_STOP','02']])assert.match(source,new RegExp(`${name}\\s*=\\s*0x${value}`,'i'));
  assert.match(source,/SUBCALLHeader[\s\S]*?0,0,1,0/);
});

test('distance commands convert wheel diameter to forward and reverse angles inside My Blocks',()=>{
 const p={main:[{type:'wheel',diameter:56},{type:'call',name:'drive',args:[20]},{type:'call',name:'drive',args:[10]}],procedures:[{name:'drive',params:['length'],body:[{type:'drive',ports:6,speed:30,cm:{param:'length'},direction:'forward',mode:'independent'},{type:'drive',ports:6,speed:20,cm:{param:'length'},direction:'backward',mode:'independent'}]}]};
 assert.deepEqual(interpret(compile(p).data),[{type:'motor',ports:6,speed:30,degrees:409},{type:'motor',ports:6,speed:-20,degrees:409},{type:'motor',ports:6,speed:30,degrees:205},{type:'motor',ports:6,speed:-20,degrees:205}]);
 assert.throws(()=>compile({...p,main:p.main.slice(1)}),/タイヤ/);
 p.main[0].diameter=0;assert.throws(()=>compile(p),/直径/);
});
test('seconds and M-motor timed motion compile to millisecond commands while retaining legacy waits',()=>{
 const p={main:[{type:'waitSeconds',seconds:.5},{type:'motorTimed',ports:1,speed:-25,seconds:1.25},{type:'wait',ms:500}],procedures:[]};
 assert.deepEqual(interpret(compile(p).data),[{type:'wait',ms:500},{type:'motorTimed',ports:1,speed:-25,ms:1250},{type:'wait',ms:500}]);
 p.main[1].seconds=0;assert.throws(()=>compile(p),/時間/);
});
test('variables, arithmetic, branch and both conditional loops run from standalone bytecode',()=>{
 const v={var:'count'},op=(op,left,right)=>({op,left,right});
 const p={main:[{type:'set',var:'count',value:0},{type:'while',condition:op('lt',v,3),until:false,body:[{type:'change',var:'count',value:1},{type:'if',condition:op('eq',v,2),then:[{type:'waitSeconds',seconds:2}],else:[{type:'waitSeconds',seconds:1}]}]},{type:'while',condition:op('eq',v,5),until:true,body:[{type:'change',var:'count',value:1}]},{type:'wait',ms:op('mul',v,100)},{type:'wait',ms:op('div',7,2)}],procedures:[]};
 const result=compile(p);assert.equal(dv(result.data).getUint32(12,true),4);
 assert.deepEqual(interpret(result.data).map(x=>x.ms),[1000,2000,1000,500,3]);
});
test('shared variables remain separate from local My Block arguments and support more than eight variables',()=>{
 const p={main:[...Array.from({length:12},(_,i)=>({type:'set',var:'v'+i,value:i})),{type:'call',name:'add',args:[5]},{type:'call',name:'add',args:[8]},{type:'wait',ms:{var:'v11'}}],procedures:[{name:'add',params:['v11'],body:[{type:'change',var:'v11',value:{param:'v11'}}]}]};
 assert.deepEqual(interpret(compile(p).data),[{type:'wait',ms:24}]);
});
test('all comparisons and Boolean operators choose the expected branch',()=>{
 const cases=[['lt',2,3,true],['lte',3,3,true],['gt',2,3,false],['gte',3,3,true],['eq',2,3,false],['neq',2,3,true],['and',1,0,false],['or',0,1,true]];
 for(const [op,left,right,expected] of cases){const p={main:[{type:'if',condition:{op,left,right},then:[{type:'wait',ms:1}],else:[{type:'wait',ms:2}]}],procedures:[]};assert.equal(interpret(compile(p).data)[0].ms,expected?1:2);p.main[0].condition={not:p.main[0].condition};assert.equal(interpret(compile(p).data)[0].ms,expected?2:1);}
});
test('invalid arithmetic and non-terminating conditions fail before transfer',()=>{
 assert.throws(()=>compile({main:[{type:'wait',ms:{op:'div',left:5,right:0}}],procedures:[]}),/0では割れ/);
 assert.throws(()=>compile({main:[{type:'while',until:false,condition:1,body:[]}],procedures:[]}),/1000回/);
 assert.throws(()=>compile({main:[{type:'set',var:'x',value:2147483647},{type:'change',var:'x',value:1}],procedures:[]}),/変数の値/);
});

test('spin turns queue opposite finite movements before waiting and wait for both targets',()=>{
 const make=direction=>({main:[{type:'wheel',diameter:56},{type:'tread',mm:112},{type:'spin',leftPort:2,rightPort:4,speed:20,angle:90,direction}],procedures:[]});
 for(const [direction,sign] of [['right',1],['left',-1]]){
   const driver=new SimulatedMotors(),starts=[],start=driver.start.bind(driver);
   driver.start=(ports,speed,degrees)=>{starts.push({ports,speed,degrees,time:driver.time});start(ports,speed,degrees);};
   const events=interpret(compile(make(direction)).data,{motorDriver:driver});
   assert.deepEqual(starts,[{ports:2,speed:20*sign,degrees:180,time:0},{ports:4,speed:-20*sign,degrees:180,time:0}]);
   assert.deepEqual(events.slice(0,2),[{type:'motor',ports:2,speed:20*sign,degrees:180},{type:'motor',ports:4,speed:-20*sign,degrees:180}]);
   assert.deepEqual(driver.position.slice(1,3),[180*sign,-180*sign]);
   assert.equal(driver.busy(15),false);assert.ok(Math.abs(driver.finished[1]-driver.finished[2])<100);assert.equal(driver.aborted,undefined);
 }
});
test('spin geometry supports decimal dimensions, arbitrary left/right ports and My Block angle arguments',()=>{
 const p={main:[{type:'tread',mm:120.5},{type:'wheel',diameter:56.2},{type:'set',var:'turn',value:90},{type:'call',name:'spin',args:[{var:'turn'}]}],procedures:[{name:'spin',params:['angle'],body:[{type:'spin',leftPort:8,rightPort:1,speed:20,angle:{param:'angle'},direction:'right'}]}]};
 const driver=new SimulatedMotors([.7,1,1,1]);const result=compile(p);
 interpret(result.data,{motorDriver:driver});
 const expected=Math.round(120.5/56.2*90);
 assert.equal(driver.position[0],-expected);assert.equal(driver.position[3],expected);assert.equal(driver.aborted,undefined);
});
test('opposite-direction feedback records signed angles and halts if a wheel stalls',()=>{
 const p={main:[{type:'wheel',diameter:56},{type:'tread',mm:112},{type:'spin',leftPort:2,rightPort:4,speed:20,angle:90,direction:'right'}],procedures:[]};
 const build=compile(p),files=new Map(),driver=new SimulatedMotors();interpret(build.data,{motorDriver:driver,files});
 assert.deepEqual(decodeTimingRecord(files.get(build.diagnosticPath),build.diagnosticTag).degrees,[180,-180]);
 const stalled=new SimulatedMotors([1,1,0,1]),stalledFiles=new Map();interpret(build.data,{motorDriver:stalled,files:stalledFiles});
 assert.equal(stalled.aborted,true);assert.equal(stalled.busy(15),false);
 assert.equal(decodeTimingRecord(stalledFiles.get(build.diagnosticPath),build.diagnosticTag).timedOut,true);
});
test('invalid spin settings fail before generating a transfer file',()=>{
 const p={main:[{type:'wheel',diameter:56},{type:'tread',mm:112},{type:'spin',leftPort:2,rightPort:4,speed:20,angle:90,direction:'right'}],procedures:[]};
 for(const change of [{leftPort:4},{rightPort:0},{speed:0},{speed:-20},{angle:0},{angle:3601},{direction:'invalid'}]){const x=structuredClone(p);Object.assign(x.main[2],change);assert.throws(()=>compile(x));}
 assert.throws(()=>compile({...p,main:[p.main[0],p.main[2]]}),/トレッド/);
 const x=structuredClone(p);x.main[1].mm=0;assert.throws(()=>compile(x),/トレッド/);
});

test('a called setup My Block initializes wheel and tread for movement and spin',()=>{
 const p={main:[{type:'call',name:'定義',args:[]},{type:'drive',ports:6,speed:20,cm:20,direction:'forward',mode:'independent'},{type:'spin',leftPort:2,rightPort:4,speed:20,angle:90,direction:'right'}],procedures:[{name:'定義',params:[],body:[{type:'call',name:'タイヤ',args:[]},{type:'tread',mm:112}]},{name:'タイヤ',params:[],body:[{type:'wheel',diameter:56}]}]};
 const driver=new SimulatedMotors(),events=interpret(compile(p).data,{motorDriver:driver});
 assert.deepEqual(events.filter(e=>e.type==='motor').slice(0,3),[{type:'motor',ports:6,speed:20,degrees:409},{type:'motor',ports:2,speed:20,degrees:180},{type:'motor',ports:4,speed:-20,degrees:180}]);
 assert.equal(driver.aborted,undefined);assert.equal(driver.busy(15),false);
});
test('wheel settings obey runtime call order and can be changed between moves',()=>{
 const move={type:'drive',ports:6,speed:20,cm:20,direction:'forward',mode:'independent'};
 const p={main:[{type:'call',name:'small',args:[]},move,{type:'call',name:'large',args:[]},move],procedures:[{name:'small',params:[],body:[{type:'wheel',diameter:56}]},{name:'large',params:[],body:[{type:'wheel',diameter:112}]}]};
 assert.deepEqual(interpret(compile(p).data).filter(e=>e.type==='motor').map(e=>e.degrees),[409,205]);
 p.main=[move,{type:'call',name:'small',args:[]}];assert.throws(()=>compile(p),/タイヤの直径/);
});

const sensor=(kind,port=3)=>({sensor:{kind,port}});
const beep=frequency=>({type:'tone',frequency,ms:100,volume:20});

test('all motor encoders return signed accumulated degrees without resetting or moving a motor',()=>{
 const counts=[-721,1080,37,-1200];
 for(let port=1;port<=4;port++)for(const type of [7,8]){
  const condition={op:'eq',left:sensor('encoder',port),right:counts[port-1]},movementLog=[];
  const data=compile({main:[{type:'if',condition,then:[beep(880)],else:[beep(440)]}],procedures:[]}).data;
  const events=interpret(data,{initialCounts:counts,motorTypes:[type,type,type,type],movementLog});
  assert.equal(events.find(e=>e.type==='tone').frequency,880);assert.deepEqual(movementLog,[]);
 }
});

test('encoder reset zeros only the selected port without changing physical position or motor speed',()=>{
 for(let port=1;port<=4;port++){
  const position=[500,-1000,720,-35],driver=new SimulatedMotors([1,1,1,1],position);
  const main=[1,2,4,8].map(ports=>({type:'motorRun',ports,speed:20}));
  main.push({type:'waitSeconds',seconds:.5},{type:'encoderReset',port});
  for(let p=1;p<=4;p++)main.push({type:'if',condition:{op:'eq',left:sensor('encoder',p),right:p===port?0:position[p-1]+100},then:[beep(880)],else:[beep(440)]});
  main.push({type:'waitSeconds',seconds:.5},{type:'if',condition:{op:'eq',left:sensor('encoder',port),right:100},then:[beep(880)],else:[beep(440)]});
  const events=interpret(compile({main,procedures:[]}).data,{motorDriver:driver});assert.deepEqual(events.filter(e=>e.type==='tone').map(e=>e.frequency),[880,880,880,880,880]);
  assert.deepEqual(driver.position,position.map(v=>v+200));assert.equal(driver.aborted,undefined);
 }
 for(const port of [0,5,1.5])assert.throws(()=>compile({main:[{type:'encoderReset',port}],procedures:[]}),/ポート/);
 const events=interpret(compile({main:[{type:'encoderReset',port:1},beep(880)],procedures:[]}).data,{motorTypes:[0,7,7,7]});assert.equal(events.at(-1).frequency,300);
});

test('on-brick encoder feedback can wait inside a My Block and stop only one running motor',()=>{
 const motors=new SimulatedMotors([1,1,1,1],[0,1000,-300,0]);
 const p={main:[{type:'set',var:'start',value:sensor('encoder',2)},{type:'motorRun',ports:6,speed:20},{type:'call',name:'角度待ち',args:[90]},{type:'stop',ports:2},{type:'waitSeconds',seconds:.5}],procedures:[{name:'角度待ち',params:['目標'],body:[{type:'while',until:true,condition:{op:'gte',left:{op:'sub',left:sensor('encoder',2),right:{var:'start'}},right:{param:'目標'}},body:[]}]}]};
 interpret(compile(p).data,{motorDriver:motors});
 assert.ok(motors.position[1]>=1090&&motors.position[1]<1095);assert.equal(motors.position[2]+300-(motors.position[1]-1000),100);assert.equal(motors.aborted,undefined);
});

test('EV3 touch and infrared proximity use their own device types and reread changing values',()=>{
 for(const [kind,type,limit]of [['touch',16,1],['infrared',33,100]])for(let port=1;port<=4;port++){
  const log=[],p={main:[{type:'if',condition:{op:'eq',left:sensor(kind,port),right:limit},then:[beep(880)],else:[beep(440)]}],procedures:[]};
  for(const value of [0,limit]){const events=interpret(compile(p).data,{sensorRead:()=>value,sensorLog:log});assert.equal(events.find(e=>e.type==='tone').frequency,value===limit?880:440);}
  assert.ok(log.every(x=>x.type===type&&x.mode===0&&x.port===port));
 }
 const readings=[0,0,1],log=[];
 const events=interpret(compile({main:[{type:'while',until:true,condition:sensor('touch',1),body:[]},beep(880)],procedures:[]}).data,{sensorRead:()=>readings.shift(),sensorLog:log});
 assert.equal(log.length,3);assert.equal(events.at(-1).frequency,880);
});

test('infrared remote reads all four channels including combined-button codes',()=>{
 for(let channel=1;channel<=4;channel++)for(const value of [0,1,4,5,8,9,10,11]){
  const values=[2,3,6,7];values[channel-1]=value;const log=[];
  const p={main:[{type:'if',condition:{op:'eq',left:{sensor:{kind:'irRemote',port:2,channel}},right:value},then:[beep(880)],else:[beep(440)]}],procedures:[]};
  assert.equal(interpret(compile(p).data,{sensorRead:()=>values,sensorLog:log}).find(e=>e.type==='tone').frequency,880);assert.deepEqual(log,[{port:2,type:33,mode:2}]);
 }
});

test('infrared beacon channel datasets preserve heading, proximity and detected status',()=>{
 const samples=[-25,0,-10,20,10,80,25,100];
 for(let channel=1;channel<=4;channel++){
  const main=[['irBeaconDetected',1],['irBeaconHeading',samples[(channel-1)*2]],['irBeaconDistance',samples[(channel-1)*2+1]]].map(([kind,right])=>({type:'if',condition:{op:'eq',left:{sensor:{kind,port:4,channel}},right},then:[beep(880)],else:[beep(440)]})),log=[];
  const events=interpret(compile({main,procedures:[]}).data,{sensorRead:()=>samples,sensorLog:log});
  assert.deepEqual(events.filter(e=>e.type==='tone').map(e=>e.frequency),[880,880,880]);assert.ok(log.every(x=>x.port===4&&x.type===33&&x.mode===1));
 }
});

test('absent infrared beacons are normal across channels and both stock NaN and raw sentinel forms',()=>{
 for(let channel=1;channel<=4;channel++)for(const absent of [NaN,-128]){
  const samples=Array(8).fill(NaN);samples[(channel-1)*2]=0;samples[(channel-1)*2+1]=absent;
  const main=[['irBeaconDetected',0],['irBeaconHeading',0],['irBeaconDistance',100]].map(([kind,right])=>({type:'if',condition:{op:'eq',left:{sensor:{kind,port:1,channel}},right},then:[beep(880)],else:[beep(440)]}));
  const events=interpret(compile({main,procedures:[]}).data,{sensorRead:()=>samples});assert.deepEqual(events.filter(e=>e.type==='tone').map(e=>e.frequency),[880,880,880]);
 }
});

test('missing, wrong-mode and malformed extended sensors stop before subsequent movement',()=>{
 const ir=kind=>({sensor:{kind,port:1,channel:4}});
 const cases=[
  [sensor('encoder',4),{motorTypes:[7,7,7,0]}],[sensor('touch',1),{sensorRead:()=>2}],[sensor('touch',1),{sensorRead:()=>1,sensorType:33}],
  [sensor('infrared',1),{sensorRead:()=>NaN}],[sensor('infrared',1),{sensorRead:()=>101}],[sensor('infrared',1),{sensorRead:()=>25,sensorMode:2}],
  [ir('irRemote'),{sensorRead:()=>[0,0,0,12]}],[ir('irRemote'),{sensorRead:()=>[0,0,0,NaN]}],
  [ir('irBeaconDistance'),{sensorRead:()=>[0,0,0,0,0,0,0,101]}],[ir('irBeaconHeading'),{sensorRead:()=>[0,0,0,0,0,0,26,50]}],
  [ir('irBeaconDetected'),{sensorRead:()=>Array(8).fill(NaN),sensorType:0}]
 ];
 for(const [value,options]of cases){const p={main:[{type:'set',var:'x',value},{type:'motorRun',ports:1,speed:20},beep(880)],procedures:[]};const events=interpret(compile(p).data,options);assert.equal(events.some(e=>e.type==='motorRun'),false);assert.equal(events.at(-1).frequency,300);}
 for(const port of [0,5])assert.throws(()=>compile({main:[{type:'set',var:'x',value:sensor('encoder',port)}],procedures:[]}),/ポート/);
 for(const channel of [0,5,1.5])assert.throws(()=>compile({main:[{type:'set',var:'x',value:{sensor:{kind:'irRemote',port:1,channel}}}],procedures:[]}),/チャンネル/);
});
test('native EV3 color, reflection and distance modes drive both branches with SI conversion',()=>{
  for(const [kind,type,mode,port,reading,threshold] of [['color',29,2,3,5,5],['reflected',29,0,2,49,50],['distance',30,0,4,14.8,15]]){
    const condition={op:kind==='color'?'eq':'lt',left:sensor(kind,port),right:threshold};
    const build=compile({main:[{type:'if',condition,then:[beep(880)],else:[beep(440)]}],procedures:[]});
    for(const [value,expected]of [[reading,880],[kind==='color'?1:100,440]]){
      const log=[],events=interpret(build.data,{sensorRead:()=>value,sensorLog:log});
      assert.equal(events.find(e=>e.type==='tone').frequency,expected);
      assert.deepEqual(log,[{port,type,mode}]);
    }
  }
});
test('sensor-dependent wait rereads on the brick until a condition changes, including inside My Blocks',()=>{
  const p={main:[{type:'call',name:'waitRed',args:[5]},beep(880)],procedures:[{name:'waitRed',params:['target'],body:[{type:'while',until:true,condition:{op:'eq',left:sensor('color'),right:{param:'target'}},body:[]}]}]};
  const samples=[1,2,5],log=[],events=interpret(compile(p).data,{sensorRead:()=>samples.shift(),sensorLog:log});
  assert.equal(log.length,3);assert.equal(events.filter(e=>e.type==='wait').length,2);assert.equal(events.at(-1).frequency,880);
});
test('sensor values persist in shared variables and ordinary arithmetic, with one read per operand',()=>{
  const p={main:[{type:'set',var:'light',value:sensor('reflected')},{type:'set',var:'speed',value:{op:'div',left:{var:'light'},right:2}},{type:'motor',ports:2,speed:{var:'speed'},degrees:90},
    {type:'if',condition:{op:'and',left:{op:'gt',left:sensor('reflected'),right:10},right:{op:'lt',left:sensor('distance',4),right:20}},then:[beep(880)],else:[beep(440)]}],procedures:[]};
  const values=[40,30,15],log=[],events=interpret(compile(p).data,{sensorRead:()=>values.shift(),sensorLog:log});
  assert.equal(log.length,3);assert.deepEqual(events.find(e=>e.type==='motor'),{type:'motor',ports:2,speed:20,degrees:90});assert.equal(events.at(-1).frequency,880);
});
test('missing or wrong sensors, unsafe runtime speeds and zero divisors stop before subsequent movement',()=>{
  const log=[],base=[{type:'set',var:'light',value:sensor('reflected')}];
  for(const [tail,options]of [
    [[{type:'motor',ports:2,speed:20,degrees:90}],{sensorRead:()=>NaN}],
    [[{type:'motor',ports:2,speed:20,degrees:90}],{sensorRead:()=>50,sensorType:30}],
    [[{type:'motor',ports:2,speed:{op:'mul',left:{var:'light'},right:10},degrees:90}],{sensorRead:()=>50}],
    [[{type:'motor',ports:2,speed:{op:'div',left:20,right:{var:'light'}},degrees:90}],{sensorRead:()=>0}],
  ]){
    const events=interpret(compile({main:[...base,...tail,beep(880)],procedures:[]}).data,{...options,sensorLog:log});
    assert.equal(events.some(e=>e.type==='motor'),false);assert.equal(events.at(-1).frequency,300);
  }
});
test('validation checks both sensor branches and does not assume a loop or conditional setup ran',()=>{
  assert.throws(()=>compile({main:[{type:'if',condition:sensor('color'),then:[beep(880)],else:[{type:'motor',ports:2,speed:150,degrees:90}]}],procedures:[]}),/速度/);
  for(const kind of ['if','while','repeat']){
    const setup={type:'wheel',diameter:56},condition=sensor('color');
    const node=kind==='if'?{type:kind,condition,then:[setup],else:[]}:kind==='while'?{type:kind,condition,body:[setup]}:{type:kind,count:condition,body:[setup]};
    assert.throws(()=>compile({main:[node,{type:'drive',ports:6,speed:20,cm:10,direction:'forward'}],procedures:[]}),/タイヤの直径/);
  }
  for(const port of [0,5,1.5])assert.throws(()=>compile({main:[{type:'set',var:'x',value:sensor('color',port)}],procedures:[]}),/ポート/);
});

test('sensor-derived geometry and paired feedback retain checked values and finish both motors',()=>{
  const p={main:[{type:'wheel',diameter:56},{type:'drive',ports:6,speed:20,cm:sensor('distance',4),direction:'forward',mode:'feedback'}],procedures:[]};
  const motors=new SimulatedMotors(),log=[];interpret(compile(p).data,{sensorRead:()=>10,motorDriver:motors,sensorLog:log});
  assert.deepEqual(motors.position.slice(1,3),[205,205]);assert.equal(log.length,1);
  p.main[1].speed={op:'sub',left:sensor('reflected'),right:60};
  assert.equal(interpret(compile(p).data,{sensorRead:()=>50}).some(e=>e.type==='motor'),false);
});

test('continuous motors return immediately, change speed/direction and stop at zero or program end',()=>{
 const motors=new SimulatedMotors([1,1,1,1]);
 const run=speed=>({type:'motorRun',ports:6,speed});
 const p={main:[run(20),{type:'wait',ms:100},run(-10),{type:'wait',ms:100},run(0),{type:'wait',ms:100}],procedures:[]};
 const events=interpret(compile(p).data,{motorDriver:motors});
 assert.deepEqual(events.filter(e=>e.type==='motorRun'),[{type:'motorRun',ports:6,speed:20},{type:'motorRun',ports:6,speed:-10}]);
 assert.deepEqual(motors.position.slice(1,3),[10,10]);assert.equal(motors.active.some(Boolean),false);
 const immediate=new SimulatedMotors();interpret(compile({main:[run(20)],procedures:[]}).data,{motorDriver:immediate});assert.equal(immediate.time,0);assert.equal(immediate.active.some(Boolean),false);
});
test('continuous motor speed can be updated from sensor conditions inside an on-brick loop',()=>{
 const p={main:[{type:'repeat',count:3,body:[{type:'if',condition:{op:'lt',left:sensor('reflected'),right:50},then:[{type:'motorRun',ports:2,speed:20}],else:[{type:'motorRun',ports:2,speed:40}]},{type:'wait',ms:20}]},{type:'stop'}],procedures:[]};
 const readings=[10,70,30],motors=new SimulatedMotors(),events=interpret(compile(p).data,{motorDriver:motors,sensorRead:()=>readings.shift()});
 assert.deepEqual(events.filter(e=>e.type==='motorRun').map(e=>e.speed),[20,40,20]);assert.equal(motors.active.some(Boolean),false);
 const bad={main:[{type:'motorRun',ports:2,speed:20},{type:'motorRun',ports:2,speed:{op:'mul',left:sensor('reflected'),right:10}}],procedures:[]};
 const failed=new SimulatedMotors();const failedEvents=interpret(compile(bad).data,{motorDriver:failed,sensorRead:()=>50});assert.equal(failedEvents.at(-1).frequency,300);assert.equal(failed.active.some(Boolean),false);
 for(const speed of [-101,101,1.5])assert.throws(()=>compile({main:[{type:'motorRun',ports:2,speed}],procedures:[]}),/速度/);
});
test('a My Block can start a continuous motor and return before a later sensor wait stops it',()=>{
 const p={main:[{type:'call',name:'run',args:[-25]},{type:'while',until:true,condition:{op:'lt',left:sensor('distance',4),right:15},body:[]},{type:'stop'}],procedures:[{name:'run',params:['speed'],body:[{type:'motorRun',ports:1,speed:{param:'speed'}}]}]};
 const readings=[30,20,10],motors=new SimulatedMotors(),events=interpret(compile(p).data,{motorDriver:motors,sensorRead:()=>readings.shift()});
 assert.deepEqual(events.find(e=>e.type==='motorRun'),{type:'motorRun',ports:1,speed:-25});assert.equal(motors.time,40);assert.equal(motors.position[0],-10);assert.equal(motors.active.some(Boolean),false);
});

test('forever loops keep both motors running and reread sensors beyond a single iteration',()=>{
 const sensorValues=[30,10,25],log=[],motors=new SimulatedMotors([1,1,1,1]);
 const p={main:[{type:'forever',body:[{type:'if',condition:{op:'lt',left:sensor('distance',4),right:15},then:[{type:'motorRun',ports:6,speed:0}],else:[{type:'motorRun',ports:6,speed:20}]}]}],procedures:[]};
 const events=interpret(compile(p).data,{motorDriver:motors,sensorRead:()=>sensorValues.shift(),sensorLog:log,waitLimit:3});
 assert.equal(log.length,3);assert.deepEqual(events.filter(e=>e.type==='motorRun').map(e=>e.ports),[6,6]);assert.equal(motors.time,60);assert.deepEqual(motors.position.slice(1,3),[8,8]);assert.deepEqual(motors.active.slice(1,3),[true,true]);
});
test('empty forever loops yield and have no synthetic repeat-count limit',()=>{
 const build=compile({main:[{type:'forever',body:[]}],procedures:[]});
 const events=interpret(build.data,{waitLimit:1005});assert.equal(events.length,1005);assert.ok(events.every(e=>e.type==='wait'&&e.ms===20));
});
test('forever loops validate changing variables conservatively and guard their motor speeds at runtime',()=>{
 const p={main:[{type:'set',var:'speed',value:0},{type:'forever',body:[{type:'change',var:'speed',value:60},{type:'motorRun',ports:6,speed:{var:'speed'}}]}],procedures:[]};
 const motors=new SimulatedMotors(),events=interpret(compile(p).data,{motorDriver:motors,waitLimit:5});
 assert.deepEqual(events.filter(e=>e.type==='motorRun').map(e=>e.speed),[60]);assert.equal(events.at(-1).frequency,300);assert.equal(motors.active.some(Boolean),false);
});

const unary=(fn,value)=>({math:{fn,value}});
const approximate=(value,expected,tolerance=.0001)=>({op:'and',left:{op:'gt',left:value,right:expected-tolerance},right:{op:'lt',left:value,right:expected+tolerance}});
test('all fourteen dropdown functions run from native float bytecode with degree-based trigonometry',()=>{
 for(const [fn,input,expected] of [['abs',-7.25,7.25],['floor',-2.3,-3],['ceil',-2.3,-2],['sqrt',2,Math.sqrt(2)],['sin',30,.5],['cos',60,.5],['tan',45,1],['asin',.5,30],['acos',.5,60],['atan',1,45],['ln',Math.E,1],['log',1000,3],['exp',1,Math.E],['pow10',-2,.01]]){
  const p={main:[{type:'set',var:'answer',value:unary(fn,input)},{type:'if',condition:approximate({var:'answer'},expected),then:[beep(880)],else:[beep(440)]}],procedures:[]},build=compile(p);
  assert.equal(build.usesFloat,true,fn);const events=interpret(build.data);assert.equal(events.at(-1).frequency,880,fn);
 }
});
test('fractional variables, changes, division and My Block parameters remain float until hardware operands',()=>{
 const p={main:[{type:'set',var:'x',value:{op:'div',left:1,right:4}},{type:'change',var:'x',value:.25},{type:'call',name:'calculate',args:[{var:'x'}]},
 {type:'if',condition:approximate({var:'result'},30),then:[beep(880)],else:[beep(440)]},{type:'motorRun',ports:2,speed:unary('abs',-20.75)},{type:'waitSeconds',seconds:.25}],procedures:[{name:'calculate',params:['input'],body:[{type:'set',var:'result',value:unary('asin',{param:'input'})}]}]};
 const build=compile(p),events=interpret(build.data);assert.equal(build.objects[1].code[1],0x83);assert.equal(events.find(e=>e.type==='tone').frequency,880);assert.deepEqual(events.find(e=>e.type==='motorRun'),{type:'motorRun',ports:2,speed:20});assert.equal(events.at(-1).ms,250);
});
test('nested functions and fractional Boolean comparisons compose with sensor expressions',()=>{
 const p={main:[{type:'set',var:'x',value:unary('sqrt',unary('abs',{op:'sub',left:sensor('reflected'),right:100}))},
 {type:'if',condition:{op:'and',left:{not:{op:'lt',left:{var:'x'},right:7}},right:approximate({var:'x'},Math.sqrt(50))},then:[beep(880)],else:[beep(440)]}],procedures:[]};
 assert.equal(interpret(compile(p).data,{sensorRead:()=>50}).at(-1).frequency,880);
});
test('unary domain errors and overflow are caught before transfer or stop a running motor safely',()=>{
 for(const [fn,value]of [['sqrt',-1],['ln',0],['log',-1],['asin',1.1],['acos',-1.1],['tan',90],['tan',270],['exp',100],['pow10',39]])assert.throws(()=>compile({main:[{type:'set',var:'x',value:unary(fn,value)}],procedures:[]}),/平方根|対数|asin|tan|範囲/);
 for(const [fn,value]of [['sqrt',-1],['ln',0],['log',-1],['asin',2],['acos',-2],['tan',90],['exp',100],['pow10',39]]){
  const motors=new SimulatedMotors(),p={main:[{type:'motorRun',ports:6,speed:20},{type:'set',var:'x',value:unary(fn,{op:'sub',left:sensor('reflected'),right:50-value})},beep(880)],procedures:[]};
  const events=interpret(compile(p).data,{sensorRead:()=>50,motorDriver:motors});assert.equal(events.at(-1).frequency,300,fn);assert.equal(motors.active.some(Boolean),false,fn);
 }
});

test('float math keeps wheel geometry, opposite-direction feedback and fractional waits usable together',()=>{
 const p={main:[{type:'wheel',diameter:56},{type:'tread',mm:112},{type:'drive',ports:6,speed:unary('abs',-20),cm:unary('sqrt',400),direction:'forward',mode:'feedback'},
 {type:'spin',leftPort:2,rightPort:4,speed:20,angle:unary('abs',-90),direction:'right'}, {type:'waitSeconds',seconds:unary('abs',-.5)}],procedures:[]};
 const motors=new SimulatedMotors(),events=interpret(compile(p).data,{motorDriver:motors});assert.deepEqual(motors.position.slice(1,3),[589,229]);assert.deepEqual(events.at(-1),{type:'wait',ms:500});assert.equal(motors.active.some(Boolean),false);
});

const ramp=(mode='trapezoid',upSeconds=.5,downSeconds=.5)=>({type:'ramp',mode,upSeconds,downSeconds});
test('trapezoid and S-curve timed profiles have distinct time-based shapes with bounded signed speeds',()=>{
 for(const mode of ['trapezoid','scurve'])for(const speed of [40,-40]){
  const driver=new SimulatedMotors([1,1,1,1]);interpret(compile({main:[ramp(mode,1,1),{type:'motorTimed',ports:6,speed,seconds:3}],procedures:[]}).data,{motorDriver:driver});
  const commands=driver.commands.filter(x=>x.ports===6),at=t=>Math.abs(commands.find(x=>x.time===t).speed);
  assert.equal(at(0),1);assert.equal(at(500),20);assert.equal(at(1000),40);assert.equal(at(2000),40);assert.equal(at(2500),20);
  assert.equal(at(200),mode==='trapezoid'?8:4);assert.equal(at(800),mode==='trapezoid'?32:35);
  assert.ok(commands.every(x=>Math.abs(x.speed)<=40&&Math.sign(x.speed)===Math.sign(speed)));assert.equal(driver.time,3000);assert.equal(driver.busy(15),false);assert.equal(driver.aborted,undefined);
 }
});
test('ramped finite moves preserve target angles, opposite directions, all port pairs and old encoder counts',()=>{
 for(const mode of ['trapezoid','scurve'])for(const ports of [1,3,5,6,9,10,12])for(const sign of [1,-1]){
  const initial=[40,-300,720,9],driver=new SimulatedMotors([1,.9,.7,1.1],initial);
  const build=compile({main:[ramp(mode),{type:'motor',ports,speed:30*sign,degrees:360,mode:'sync'}],procedures:[]});interpret(build.data,{motorDriver:driver});
  assert.equal(driver.aborted,undefined);for(let port=0;port<4;port++)assert.equal(driver.position[port],initial[port]+(ports&(1<<port)?360*sign:0));
  assert.equal(driver.busy(15),false);assert.ok(driver.commands.some(x=>Math.abs(x.speed)>1));assert.ok(driver.commands.every(x=>(x.ports&ports)===x.ports&&Math.abs(x.speed)<=30));
  assert.equal(build.diagnosticPath,null);
 }
});
test('ramp settings survive setup subcalls and apply to distance, spin and timed L/M actions',()=>{
 const driver=new SimulatedMotors([1,1,1,1]);const p={main:[{type:'call',name:'setup',args:[1]},{type:'drive',ports:6,speed:30,cm:20,direction:'backward'},{type:'spin',leftPort:2,rightPort:4,speed:30,angle:90,direction:'right'},{type:'motorTimed',ports:1,speed:20,seconds:1}],procedures:[{name:'setup',params:['up'],body:[ramp('scurve',{param:'up'},.5),{type:'wheel',diameter:56},{type:'tread',mm:112}]}]};
 interpret(compile(p).data,{motorDriver:driver,motorTypes:[8,7,7,7]});assert.deepEqual(driver.position.slice(1,3),[-229,-589]);assert.equal(driver.aborted,undefined);assert.equal(driver.busy(15),false);
});
test('short, zero-ramp and low-speed moves terminate without exceeding peak speed or losing angle',()=>{
 for(const mode of ['trapezoid','scurve'])for(const degrees of [1,5,20])for(const speed of [1,100]){
  const driver=new SimulatedMotors([1,1,1,1]);interpret(compile({main:[ramp(mode,2,2),{type:'motor',ports:2,speed,degrees}],procedures:[]}).data,{motorDriver:driver});assert.equal(driver.position[1],degrees,JSON.stringify({mode,degrees,speed,target:driver.target,time:driver.time,head:driver.commands.slice(0,35),tail:driver.commands.slice(-3)}));assert.equal(driver.aborted,undefined);assert.ok(driver.commands.every(x=>x.speed>=0&&x.speed<=speed));
 }
 for(const [up,down]of [[0,0],[0,.5],[.5,0]]){
  const driver=new SimulatedMotors([1,1,1,1]);interpret(compile({main:[ramp('scurve',up,down),{type:'motor',ports:2,speed:20,degrees:90},{type:'motorTimed',ports:1,speed:20,seconds:.04}],procedures:[]}).data,{motorDriver:driver});assert.equal(driver.position[1],90);assert.equal(driver.aborted,undefined);
 }
 const short=new SimulatedMotors();interpret(compile({main:[ramp('trapezoid',1,1),{type:'motorTimed',ports:2,speed:40,seconds:.5}],procedures:[]}).data,{motorDriver:short});assert.ok(Math.max(...short.commands.map(x=>x.speed))<=10);assert.equal(short.time,500);
});
test('off restores legacy control and profile setting changes take effect in execution order',()=>{
 const driver=new SimulatedMotors([1,1,1,1]);const p={main:[ramp('scurve'),{type:'motor',ports:2,speed:20,degrees:90},ramp('off'),{type:'motor',ports:2,speed:-20,degrees:90}],procedures:[]};
 const events=interpret(compile(p).data,{motorDriver:driver});assert.equal(driver.position[1],0);assert.equal(events.filter(x=>x.type==='motor').at(-1).speed,-20);assert.equal(driver.aborted,undefined);
});
test('missing or stalled ramp-controlled motors stop all ports and do not continue to later blocks',()=>{
 for(const options of [{motorTypes:[7,7,0,7]},{motorDriver:new SimulatedMotors([1,1,0,1])}]){
  const driver=options.motorDriver??new SimulatedMotors();const events=interpret(compile({main:[ramp('scurve'),{type:'motor',ports:6,speed:20,degrees:90},beep(880)],procedures:[]}).data,{...options,motorDriver:driver});assert.equal(driver.aborted,true);assert.equal(driver.busy(15),false);assert.equal(events.some(x=>x.frequency===880),false);
 }
});
test('ramp setting rejects invalid times and unknown modes, including sensor-derived invalid times',()=>{
 for(const change of [{mode:'other'},{upSeconds:-1},{downSeconds:11},{upSeconds:NaN}])assert.throws(()=>compile({main:[{...ramp(),...change}],procedures:[]}));
 const events=interpret(compile({main:[ramp('scurve',{sensor:{kind:'distance',port:1}},.5),{type:'motor',ports:2,speed:20,degrees:90}],procedures:[]}).data,{sensorRead:()=>15});assert.equal(events.some(x=>x.type==='motor'),false);assert.equal(events.at(-1).frequency,300);
});

test('profile defaults do not leak from uncalled definitions and a runtime branch sets the executed profile only',()=>{
 const plain={type:'motor',ports:2,speed:20,degrees:90};
 const p={main:[{type:'if',condition:{sensor:{kind:'touch',port:1}},then:[ramp('scurve')],else:[ramp('off')]},plain],procedures:[]};
 for(const value of [0,1]){const driver=new SimulatedMotors([1,1,1,1]);interpret(compile(p).data,{motorDriver:driver,sensorRead:()=>value});assert.equal(driver.position[1],90);assert.equal(driver.commands.length>0,!!value);assert.equal(driver.aborted,undefined);}
 const driver=new SimulatedMotors();interpret(compile({main:[plain],procedures:[{name:'unused',params:[],body:[ramp('scurve')]}]}).data,{motorDriver:driver});assert.equal(driver.commands.length,0);assert.equal(driver.position[1],90);
});
test('ramped timed commands stop selected ports only and pair commands start together',()=>{
 const driver=new SimulatedMotors([1,1,1,1]),starts=[],start=driver.startContinuous.bind(driver);
 driver.startContinuous=(ports,speed)=>{starts.push({ports,time:driver.time});start(ports,speed);};
 const p={main:[{type:'motorRun',ports:1,speed:20},ramp('scurve'),{type:'motorTimed',ports:6,speed:30,seconds:2},{type:'waitSeconds',seconds:.5}],procedures:[]};
 interpret(compile(p).data,{motorDriver:driver});assert.deepEqual(starts,[{ports:1,time:0},{ports:6,time:0}]);assert.equal(driver.position[0],500);assert.equal(driver.position[1],driver.position[2]);assert.equal(driver.busy(15),false);
});

test('completion sound follows successful readback verification and leaves the saved program untouched',async()=>{
 const order=[],data=compile(sound).data,connection=new EV3Connection();
 connection.transfer=async(bytes,name,progress,folder)=>{assert.equal(bytes,data);assert.equal(name,'Done.rbf');assert.equal(folder,'Class3');order.push('verified');return '../prjs/Class3/Done.rbf';};
 connection.signalTransferComplete=async()=>order.push('sound');
 const original=data.slice();assert.deepEqual(await connection.transferWithSignal(data,'Done.rbf',()=>{},'Class3'),{path:'../prjs/Class3/Done.rbf',soundError:null});assert.deepEqual(order,['verified','sound']);assert.deepEqual(data,original);
});
test('failed upload or verification never triggers the completion signal',async()=>{
 for(const reason of ['write denied','readback mismatch']){const connection=new EV3Connection();let signals=0;connection.transfer=async()=>{throw Error(reason);};connection.signalTransferComplete=async()=>signals++;await assert.rejects(connection.transferWithSignal(new Uint8Array([1]),'Done.rbf'),new RegExp(reason));assert.equal(signals,0);}
});
test('completion sound failure keeps verification successful and reports the separate notification failure',async()=>{
 for(const reason of ['disconnected','timeout','sound rejected']){const logs=[],connection=new EV3Connection((...args)=>logs.push(args));connection.transfer=async()=> '../prjs/EV3Lab/Done.rbf';connection.signalTransferComplete=async()=>{throw Error(reason);};const result=await connection.transferWithSignal(new Uint8Array([1]),'Done.rbf');assert.equal(result.path,'../prjs/EV3Lab/Done.rbf');assert.equal(result.soundError,reason);assert.equal(logs[0][0],'完了音エラー');}
});
test('completion direct command contains only two short tones with waits and validates its reply',async()=>{
 const connection=new EV3Connection(),expected=[0,0,0x94,...constant(1),...constant(25),...constant(660),...constant(80),0x96,0x94,...constant(1),...constant(25),...constant(880),...constant(120),0x96];
 connection.request=async(type,payload,timeout)=>{assert.equal(type,0);assert.equal(timeout,3000);assert.deepEqual(payload,expected);return packet(1,2,[]);};await connection.signalTransferComplete();
 connection.request=async()=>packet(1,4,[]);await assert.rejects(connection.signalTransferComplete(),/完了音/);connection.request=async()=>packet(1,2,[1]);await assert.rejects(connection.signalTransferComplete(),/完了音/);
});

const pivot=direction=>({type:'pivot',leftPort:2,rightPort:4,speed:20,angle:90,direction});
test('pivot turns brake the inside wheel first and move only the outside wheel at twice the spin angle',()=>{
 for(const leftPort of [1,2,4,8])for(const rightPort of [1,2,4,8].filter(p=>p!==leftPort))for(const direction of ['left','right']){
  const stationary=direction==='right'?rightPort:leftPort,moving=direction==='right'?leftPort:rightPort,initial=[10,720,-300,5],driver=new SimulatedMotors([1,1,1,1],initial),stops=[],stop=driver.stop.bind(driver);
  driver.stop=ports=>{stops.push({ports,time:driver.time});stop(ports);};
  const p={main:[{type:'motorRun',ports:stationary,speed:20},{type:'wheel',diameter:56},{type:'tread',mm:112},{...pivot(direction),leftPort,rightPort},{type:'waitSeconds',seconds:.1}],procedures:[]};
  const events=interpret(compile(p).data,{motorDriver:driver});assert.deepEqual(stops[0],{ports:stationary,time:0});assert.deepEqual(events.filter(e=>e.type==='motor'),[{type:'motor',ports:moving,speed:20,degrees:360}]);
  for(let i=0;i<4;i++)assert.equal(driver.position[i],initial[i]+(moving===(1<<i)?360:0));assert.equal(driver.busy(15),false);
 }
});
test('pivot geometry and ramp control work through My Block parameters and decimal robot dimensions',()=>{
 for(const mode of ['trapezoid','scurve']){
  const driver=new SimulatedMotors([1,1,.7,1]);const p={main:[{type:'call',name:'setup',args:[]},{type:'call',name:'turn',args:[90]}],procedures:[{name:'setup',params:[],body:[ramp(mode),{type:'wheel',diameter:56.2},{type:'tread',mm:120.5}]},{name:'turn',params:['angle'],body:[{...pivot('left'),angle:{param:'angle'}}]}]};
  interpret(compile(p).data,{motorDriver:driver});assert.equal(driver.position[1],0);assert.equal(driver.position[2],Math.round(2*120.5/56.2*90));assert.equal(driver.aborted,undefined);assert.ok(driver.commands.every(x=>x.ports===4));
 }
});
test('pivot turn settings reject invalid geometry, duplicate ports, directions, angles and speeds',()=>{
 const p={main:[{type:'wheel',diameter:56},{type:'tread',mm:112},pivot('right')],procedures:[]};
 for(const change of [{leftPort:4},{rightPort:0},{direction:'unknown'},{angle:0},{angle:3601},{speed:0},{speed:-10},{speed:101}]){const changed=structuredClone(p);Object.assign(changed.main[2],change);assert.throws(()=>compile(changed));}
 assert.throws(()=>compile({...p,main:[p.main[1],p.main[2]]}),/直径/);assert.throws(()=>compile({...p,main:[p.main[0],p.main[2]]}),/トレッド/);
 const huge=structuredClone(p);huge.main[0].diameter=10;huge.main[1].mm=1000;huge.main[2].angle=3600;assert.throws(()=>compile(huge),/回転角度/);
});
test('sensor-driven pivot angle is checked on the brick before the moving wheel starts',()=>{
 const main=[{type:'wheel',diameter:56},{type:'tread',mm:112},{...pivot('right'),angle:{sensor:{kind:'distance',port:1}}}];
 const driver=new SimulatedMotors([1,1,1,1]),events=interpret(compile({main,procedures:[]}).data,{motorDriver:driver,sensorRead:()=>90});assert.equal(events.find(e=>e.type==='motor').degrees,360);assert.equal(driver.position[1],360);
 const invalid=interpret(compile({main,procedures:[]}).data,{sensorRead:()=>0});assert.equal(invalid.some(e=>e.type==='motor'),false);assert.equal(invalid.at(-1).frequency,300);
});

const tank=(leftSpeed,rightSpeed,leftPort=2,rightPort=4)=>({type:'tank',leftPort,rightPort,leftSpeed,rightSpeed});
test('tank control queues both signed speeds and starts all selected nonzero outputs together',()=>{
 for(const leftPort of [1,2,4,8])for(const rightPort of [1,2,4,8].filter(p=>p!==leftPort))for(const [leftSpeed,rightSpeed]of [[100,50],[50,-50],[-100,25],[0,50],[50,0],[0,0]]){
  const driver=new SimulatedMotors([1,1,1,1]),starts=[],start=driver.startContinuous.bind(driver);driver.startContinuous=(ports,speed)=>{starts.push({ports,speed,time:driver.time});start(ports,speed);};
  interpret(compile({main:[tank(leftSpeed,rightSpeed,leftPort,rightPort),{type:'waitSeconds',seconds:1}],procedures:[]}).data,{motorDriver:driver});
  for(let i=0;i<4;i++)assert.equal(driver.position[i],(1<<i)===leftPort?leftSpeed*10:(1<<i)===rightPort?rightSpeed*10:0);
  assert.ok(starts.every(x=>x.time===0));assert.equal(starts.length>0,leftSpeed!==0||rightSpeed!==0);assert.equal(driver.busy(15),false);
 }
});
test('tank updates take effect until stopped and preserve other running ports',()=>{
 const driver=new SimulatedMotors([1,1,1,1]);const p={main:[{type:'motorRun',ports:1,speed:20},tank(30,0),{type:'waitSeconds',seconds:1},tank(-10,50),{type:'waitSeconds',seconds:1},tank(0,0),{type:'waitSeconds',seconds:1}],procedures:[]};
 interpret(compile(p).data,{motorDriver:driver});assert.deepEqual(driver.position,[600,200,500,0]);assert.equal(driver.aborted,undefined);
});
test('tank speeds can be sensor expressions or My Block arguments and invalid right input does not change left output',()=>{
 const driver=new SimulatedMotors([1,1,1,1]);const p={main:[{type:'call',name:'tank',args:[-40,20]},{type:'waitSeconds',seconds:.5}],procedures:[{name:'tank',params:['left','right'],body:[tank({param:'left'},{param:'right'})]}]};interpret(compile(p).data,{motorDriver:driver});assert.deepEqual(driver.position,[0,-200,100,0]);
 const invalid=new SimulatedMotors(),events=interpret(compile({main:[tank(40,{op:'mul',left:{sensor:{kind:'reflected',port:1}},right:2}),beep(880)],procedures:[]}).data,{motorDriver:invalid,sensorRead:()=>60});assert.equal(invalid.commands.length,0);assert.equal(invalid.busy(15),false);assert.equal(events.at(-1).frequency,300);
});
test('tank control rejects invalid speed ranges and duplicate or non-single ports',()=>{
 for(const block of [tank(101,0),tank(0,-101),tank(.5,20),tank(20,20,2,2),tank(20,20,3,4),tank(20,20,1,0)])assert.throws(()=>compile({main:[block],procedures:[]}));
});
