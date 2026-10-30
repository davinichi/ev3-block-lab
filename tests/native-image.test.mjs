import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compile} from '../dist/ev3.js';

// Structural scanner independent of the execution VM. Firmware validates every
// byte in sequence, including RETURN/fault paths that a successful run skips.
// Operand counts follow LEGO bytecodes.c; INPUT_DEVICE READY_SI is variadic.
function scanImage(data){
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength),size=view.getUint32(4,true),objects=view.getUint16(10,true),instructions=[];
 assert.equal(size,data.length);let cursor=16+12*objects;
 const counts={0x13:3,0x17:3,0x1b:3,0x1f:3,0x3b:2,0x3f:2,0x47:3,0x4b:3,0x4f:3,0x53:3,0x57:3,0x5b:3,0x67:3,0x6b:3,2:1,8:0,0x12:3,0x16:3,0x1a:3,0x1e:3,0x22:3,0x26:3,0x3a:2,0x3e:2,0x40:1,0x46:3,0x4a:3,0x4e:3,0x52:3,0x56:3,0x5a:3,0x66:3,0x6a:3,0x85:2,0x86:1,0x87:1,0x96:0,0xa2:2,0xb2:2,0xa3:3,0xa5:3,0xa6:2,0xa9:3,0xaa:2,0xae:7,0xaf:7,0xb0:6,0xb3:3};
 for(let object=0;object<objects;object++){
  const start=view.getUint32(16+12*object,true),end=object+1<objects?view.getUint32(28+12*object,true):size;
  assert.equal(cursor,start,'Object headers must agree with the sequential firmware scan');
  const localSize=view.getUint32(24+12*object,true),boundaries=new Set(),jumps=[];
  if(view.getUint16(20+12*object,true)===0&&view.getUint16(22+12*object,true)===1){const n=data[cursor++];for(let i=0;i<n;i++)assert.ok([0x82,0x83].includes(data[cursor++]));}
  const parameter=()=>{
   assert.ok(cursor<end);const tag=data[cursor++];let value,variable=false;
   if(tag===0x84){while(cursor<end&&data[cursor]!==0)cursor++;assert.ok(cursor<end);cursor++;return null;}
   if(tag&128){const n={1:1,2:2,3:4}[tag&7];assert.ok(n);assert.ok(cursor+n<=end);variable=!!(tag&64);value=n===1?(variable?view.getUint8(cursor):view.getInt8(cursor)):n===2?(variable?view.getUint16(cursor,true):view.getInt16(cursor,true)):view.getInt32(cursor,true);cursor+=n;}
   else if(tag&64){variable=true;value=tag&31;}
   else value=(tag&32)?(tag&63)-64:tag&63;
   if(variable){const bytes=tag&32?view.getUint32(12,true):localSize;assert.ok(value>=0&&value<bytes,'Variable must be inside its memory region');return null;}
   return value;
  };
  while(cursor<end){
   const at=cursor,op=data[cursor++];boundaries.add(at);let args=[];
   if(op===0x0a){instructions.push({at,op,end:cursor});break;}
   if(op===9){args=[parameter(),parameter()];assert.ok(Number.isInteger(args[1]));for(let i=0;i<args[1];i++)parameter();}
   else if(op===0x99){const cmd=parameter();if(cmd===29){args=Array.from({length:5},parameter);assert.ok(Number.isInteger(args[4]));for(let i=0;i<args[4];i++)parameter();}else{assert.equal(cmd,5);for(let i=0;i<4;i++)parameter();}}
   else if(op===0x8d){const cmd=parameter();assert.ok([1,2,3,4,6,8,9,10,11,12,13,14,15,16,20].includes(cmd));for(let i=0;i<([2,20].includes(cmd)?3:2);i++)parameter();}
   else if(op===0x94){assert.equal(parameter(),1);for(let i=0;i<3;i++)parameter();}
   else if(op===0xc0){const cmd=parameter(),n={2:2,7:1,29:3}[cmd];assert.ok(n);for(let i=0;i<n;i++)parameter();}
   else{assert.ok(Object.hasOwn(counts,op),'Unknown opcode '+op.toString(16));args=Array.from({length:counts[op]},parameter);}
   const instruction={at,op,end:cursor};instructions.push(instruction);
   if([0x40,0x66,0x6a,0x67,0x6b].includes(op))jumps.push({at,target:cursor+args.at(-1)});
  }
  assert.equal(data[cursor-1],0x0a,'Object must terminate with OBJECT_END');
  assert.equal(cursor,end,'First OBJECT_END must be at the declared object boundary; firmware rejects trailing bytes');
  for(const jump of jumps)assert.ok(boundaries.has(jump.target),'Jump must land on an instruction inside the object');
 }
 assert.equal(cursor,size);return instructions;
}
const tone=frequency=>({type:'tone',frequency,ms:200,volume:25});

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
