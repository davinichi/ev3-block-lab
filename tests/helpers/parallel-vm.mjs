import assert from 'node:assert/strict';
const dv=data=>new DataView(data.buffer,data.byteOffset,data.byteLength);
// Generated RBF is executed one instruction per scheduling turn. This intentionally
// stresses every possible shared-data boundary; it is not a real-time hardware model.
export function runParallel(bytes,{initialCounts=[0,0,0,0],movementLog=[],motorDriver=null,files=new Map(),sensorRead=()=>NaN,sensorType=null,sensorMode=null,motorTypes=[7,7,7,7],sensorLog=[],buttonRead=()=>false,waitLimit=Infinity,maxTime=5000}={}){
  const handles=new Map(),arrays=new Map();let nextArray=10;
  const counts=[...initialCounts],pendingSpeed=[0,0,0,0];
  const shared=dv(new Uint8Array(dv(bytes).getUint32(12,true)));
  const view=dv(bytes),headers=[];for(let i=0;i<view.getUint16(10,true);i++)headers.push({pc:view.getUint32(16+12*i,true),size:view.getUint32(24+12*i,true),sub:view.getUint16(22+12*i,true)===1});
  const encoderOffsets=[0,0,0,0];const events=[];let budget=5000000,completedWaits=0,time=0,stopped=false;const tasks=new Map(),busy=new Set();const activeModes=new Map();
  const execute=function*(id,args=[]){
    let pc=headers[id-1].pc;const memory=new Uint8Array(headers[id-1].size),own=dv(memory);
    const m=Object.fromEntries([8,16,32].flatMap(bits=>[['getInt'+bits,(at,...args)=>at<0?shared['getInt'+bits](-at-1,...args):own['getInt'+bits](at,...args)],['setInt'+bits,(at,...args)=>at<0?shared['setInt'+bits](-at-1,...args):own['setInt'+bits](at,...args)]]));
    if(headers[id-1].sub){const count=bytes[pc++];assert.equal(count,args.length);for(let i=0;i<count;i++){assert.ok([0x82,0x83].includes(bytes[pc++]));m.setInt32(i*4,args[i],true);}}
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
    const pointer=()=>{if(bytes[pc]===0x84){const data=new TextEncoder().encode(param()+'\0');return {get:i=>data[i],set:()=>{throw Error('constant write');}};}const at=param(1,true);return {get:i=>m.getInt8(at<0?at-i:at+i)&255,set:(i,v)=>m.setInt8(at<0?at-i:at+i,v)};};
    const string=()=>{const p=pointer();let a=[];for(let i=0;i<124;i++){const b=p.get(i);if(!b)return new TextDecoder().decode(new Uint8Array(a));a.push(b);}throw Error('unterminated string');};
    const putString=(p,s,max=124)=>{const a=new TextEncoder().encode(s);assert.ok(a.length<max);a.forEach((b,i)=>p.set(i,b));p.set(a.length,0);};
    const floatBits=new DataView(new ArrayBuffer(4));
    const fparam=()=>{floatBits.setInt32(0,param(),true);return floatBits.getFloat32(0,true);};
    const setFloat=(at,n)=>{floatBits.setFloat32(0,n,true);m.setInt32(at,floatBits.getInt32(0,true),true);};
    while(--budget>0){
      const op=bytes[pc++];
      switch(op){
        case 0x84:{const cmd=param(1);let args=[];if([17,18].includes(cmd))args=[param(1)];else if([3,9].includes(cmd))args=[param(1),param(2),param(2),param(2),param(2)];else if(cmd===8)args=[param(1),param(2),param(2),fparam(),param(1),param(1)];else assert.ok([0,1].includes(cmd));events.push({type:'draw',cmd,args,task:id});break;}
        case 0x0a:case 0x08:return;
        case 5:{const target=param(2);tasks.set(target,{gen:execute(target),until:0});break;}
        case 7:{const target=param(2);while(tasks.has(target))yield {until:time+1};break;}
        case 9:{const target=param(2),count=param(1),args=[];for(let i=0;i<count;i++)args.push(param());while(busy.has(target))yield {until:time+1};busy.add(target);yield* execute(target,args);busy.delete(target);break;}
        case 0x83:{assert.equal(param(1),9);const button=param(1),at=param(1,true);assert.ok(button>=1&&button<=5);m.setInt8(at,+buttonRead(button,time));break;}
        case 0x94:{assert.equal(param(1),1);const volume=param(1),frequency=param(2),ms=param(2);events.push({type:'tone',volume,frequency,ms});break;}
        case 0x96:break;
        case 0x85:{const ms=param(),at=param(4,true);m.setInt32(at,(time)+ms,true);events.push({type:'wait',ms});break;}
        case 0x86:{const deadline=param();while(time<deadline)yield {until:deadline};if(++completedWaits>=waitLimit)throw Error('TEST_WAIT_LIMIT');break;}
        case 0x87:{const at=param(4,true);m.setInt32(at,time,true);break;}
        case 0xae:{assert.equal(param(1),0);const ports=param(1),speed=param(1);assert.equal(param(),0);const degrees=param();assert.equal(param(),0);const brake=param(1);events.push({type:'motor',ports,speed,degrees,brake,time});motorDriver?.start(ports,speed,degrees);break;}
        case 0xaf:{assert.equal(param(1),0);const ports=param(1),speed=param(1);assert.equal(param(),0);const ms=param();assert.equal(param(),0);const brake=param(1);events.push({type:'motorTimed',ports,speed,ms,brake,time});motorDriver?.startTimed?.(ports,speed,ms);break;}
        case 0xa4:{assert.equal(param(1),0);const ports=param(1),power=param(1);for(let i=0;i<4;i++)if(ports&(1<<i))pendingSpeed[i]=power;events.push({type:'power',ports,power,time});motorDriver?.setPower?.(ports,power);break;}
        case 0xa8:{assert.equal(param(1),0);const port=param(1),speed=param(1,true),steps=param(4,true);m.setInt8(speed,motorDriver?.actualSpeed?.(port)??motorDriver?.speed?.[port]??0);m.setInt32(steps,Math.round(motorDriver?.position?.[port]??0),true);break;}
        case 0x32:{const v=param(1),at=param(4,true);m.setInt32(at,v,true);break;}
        case 0xa5:{assert.equal(param(1),0);const ports=param(1),speed=param(1);for(let i=0;i<4;i++)if(ports&(1<<i))pendingSpeed[i]=speed;motorDriver?.setSpeed(ports,speed);break;}
        case 0xa6:{assert.equal(param(1),0);const ports=param(1),selected=[0,1,2,3].filter(i=>ports&(1<<i)),speed=pendingSpeed[selected[0]],different=selected.some(i=>pendingSpeed[i]!==speed);events.push({type:'motorRun',ports,speed,...(different?{speeds:selected.map(i=>({port:i,speed:pendingSpeed[i]}))}:{})});if(different)for(const i of selected)motorDriver?.startContinuous(1<<i,pendingSpeed[i]);else motorDriver?.startContinuous(ports,speed);break;}
        case 0xa9:{assert.equal(param(1),0);const ports=param(1),at=param(1,true);m.setInt8(at,motorDriver?.busy(ports)?1:0);break;}
        case 0xb3:{assert.equal(param(1),0);const port=param(1),at=param(4,true);m.setInt32(at,motorDriver?Math.round(motorDriver.position[port]-encoderOffsets[port]):counts[port],true);break;}
        case 0xb2:{assert.equal(param(1),0);const ports=param(1);for(let i=0;i<4;i++)if(ports&(1<<i)){if(motorDriver)encoderOffsets[i]=motorDriver.position[i];else counts[i]=0;}break;}
        case 0xa2:{assert.equal(param(1),0);const ports=param(1);for(let i=0;i<4;i++)if(ports&(1<<i))counts[i]=0;break;}
        case 0xb0:{assert.equal(param(1),0);const ports=param(1),speed=param(1),turn=param(2),degrees=param();const brake=param(1);assert.ok([0,1].includes(brake));events.push({type:'motorSync',ports,speed,turn,degrees,brake,time});motorDriver?.startSync?.(ports,speed,turn,degrees);
          // Firmware sync compares the two accumulated TachoCnt values. In the
          // ideal equal-count end state, an old offset reduces physical travel.
          for(let i=0;i<4;i++)if(ports&(1<<i)){movementLog.push({port:i,degrees:Math.sign(speed)*degrees-counts[i]});counts[i]=0;}break;}
        case 0xaa:{param(1);const ports=param(1);if(motorDriver)while(motorDriver.busy(ports))yield {until:time+5};break;}
        case 0xa3:{param(1);const ports=param(1),brake=param(1);events.push({type:'stop',ports,brake,time});motorDriver?.stop(ports);break;}
        case 0x02:{assert.equal(param(2),-1);if(motorDriver)motorDriver.aborted=true;stopped=true;return;}
        case 0x82:assert.equal(param(1),27);events.push({type:'led',pattern:param(1)});break;
        case 0x36:{const n=param(2),at=param(4,true);m.setInt32(at,n,true);break;}
        case 0x8e:{const lo=param(2),hi=param(2),at=param(2,true);assert.ok(lo<=hi);m.setInt16(at,lo,true);break;}
        case 0xc8:{const p=pointer(),i=param(1),at=param(1,true);assert.ok(i>=0&&i<=120);m.setInt8(at,p.get(i));break;}
        case 0xcc:{const value=param(1),i=param(1),p=pointer();assert.ok(i>=0&&i<=120);p.set(i,value);break;}
        case 0x7d:{const cmd=param(1);if(cmd===11){const n=fparam(),fmt=string(),size=param(1),dest=pointer();putString(dest,fmt==='%.3f'?n.toFixed(3):String(Number(n.toPrecision(7))),size);}else if(cmd===5){const src=string(),dest=pointer();putString(dest,src);}else if(cmd===7){const str=string(),at=param(4,true);setFloat(at,Number(str));}else throw Error('STRINGS '+cmd);break;}
        case 0xc1:{const cmd=param(1);if(cmd===4){const size=param(),at=param(2,true),id=nextArray++;arrays.set(id,Array(size).fill(0));m.setInt16(at,id,true);}else if(cmd===12){const h=param(2),at=param(4,true);m.setInt32(at,arrays.get(h).length,true);}else if(cmd===5){const h=param(2),n=param();arrays.get(h).length=n;}else throw Error('ARRAY '+cmd);break;}
        case 0xc2:{const h=param(2),i=param(),v=fparam();assert.ok(i>=0&&i<arrays.get(h).length);arrays.get(h)[i]=v;break;}
        case 0xc3:{const h=param(2),i=param(),at=param(4,true);assert.ok(i>=0&&i<arrays.get(h).length);setFloat(at,arrays.get(h)[i]);break;}
        case 0xc4:{const h=param(2),v=fparam();arrays.get(h).push(v);break;}
        case 0xb1:{assert.equal(param(1),0);const ports=param(1),speed=param(1),turn=param(2),ms=param(),brake=param(1);events.push({type:'steeringTime',ports,speed,turn,ms,brake,time});motorDriver?.startSyncTimed?.(ports,speed,turn,ms);break;}
        case 0xc0:{const command=param(1);
          if(command===2||command===0){const path=string(),at=param(2,true);if(command===2||!files.has(path))files.set(path,new Uint8Array());handles.set(1,path);m.setInt16(at,1,true);}
          else if(command===6){const handle=param(2);assert.equal(param(1),0);const src=pointer(),raw=[];for(let i=0;i<124&&src.get(i);i++)raw.push(src.get(i));const path=handles.get(handle);assert.ok(path);files.set(path,new Uint8Array([...files.get(path),...raw]));}
          else if(command===29){const handle=param(2),length=param(2),source=param(1,true),path=handles.get(handle);assert.ok(path);assert.ok(source+length<=memory.length);files.set(path,new Uint8Array([...files.get(path),...memory.slice(source,source+length)]));}
          else if(command===7){const handle=param(2);assert.ok(handles.has(handle));handles.delete(handle);}
          else throw Error(`Unsupported FILE command ${command}`);break;}
        case 0x99:{const command=param(1);assert.equal(param(1),0);const port=param(1);
          if(command===29){const type=param(1),mode=param(1),count=param(1),sample={port:port+1,type,mode};assert.ok(count>=1&&count<=8);sensorLog.push({...sample,time});activeModes.set(port,sample);const readings=sensorRead({...sample,time});for(let i=0;i<count;i++){const at=param(4,true);m.setInt32(at,0,true);own.setFloat32(at,Array.isArray(readings)?readings[i]:readings,true);}}
          else if(command===5){const typeAt=param(1,true),modeAt=param(1,true);if(port>=16){assert.ok(port<=19);m.setInt8(typeAt,motorTypes[port-16]);m.setInt8(modeAt,0);}else{const last=activeModes.get(port);assert.equal(port+1,last.port);m.setInt8(typeAt,sensorType??last.type);m.setInt8(modeAt,sensorMode??last.mode);}}
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
      yield {until:time};
    }
    throw Error('VM budget exceeded');
  };
  tasks.set(1,{gen:execute(1),until:0});
  while(tasks.size&&!stopped&&time<=maxTime){
    let progressed=false;
    for(const [id,t] of [...tasks]){
      if(t.until>time)continue;
      progressed=true;const result=t.gen.next();
      if(result.done)tasks.delete(id);else t.until=result.value.until;
      if(stopped)break;
    }
    if(!progressed){const next=Math.min(...[...tasks.values()].map(t=>t.until));if(next>maxTime)break;motorDriver?.advance(next-time);time=next;}
  }
  return {events,time,stopped,shared,files,tasks:tasks.size,sensorLog};
}
