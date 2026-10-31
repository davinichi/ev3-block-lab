import assert from 'node:assert/strict';
// Structural scanner independent of the execution VM. Firmware validates every
// byte in sequence, including RETURN/fault paths that a successful run skips.
// Operand counts follow LEGO bytecodes.c; INPUT_DEVICE READY_SI is variadic.
export function scanImage(data){
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength),size=view.getUint32(4,true),objects=view.getUint16(10,true),instructions=[];
 assert.equal(size,data.length);let cursor=16+12*objects;
 const counts={0x32:2,0xa4:3,0xa8:4,5:1,7:1,0x36:2,0x8e:3,0xc8:3,0xcc:3,0xc2:3,0xc3:3,0xc4:2,0xb1:6,0x13:3,0x17:3,0x1b:3,0x1f:3,0x3b:2,0x3f:2,0x47:3,0x4b:3,0x4f:3,0x53:3,0x57:3,0x5b:3,0x67:3,0x6b:3,2:1,8:0,0x12:3,0x16:3,0x1a:3,0x1e:3,0x22:3,0x26:3,0x3a:2,0x3e:2,0x40:1,0x46:3,0x4a:3,0x4e:3,0x52:3,0x56:3,0x5a:3,0x66:3,0x6a:3,0x85:2,0x86:1,0x87:1,0x96:0,0xa2:2,0xb2:2,0xa3:3,0xa5:3,0xa6:2,0xa9:3,0xaa:2,0xae:7,0xaf:7,0xb0:6,0xb3:3};
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
   else if(op===0x82){assert.equal(parameter(),27);parameter();}
   else if(op===0xc1){const cmd=parameter(),n={4:2,5:2,12:2}[cmd];assert.ok(n);for(let i=0;i<n;i++)parameter();}
   else if(op===0x7d){const cmd=parameter(),n={5:2,7:2,11:4}[cmd];assert.ok(n);for(let i=0;i<n;i++)parameter();}
   else if(op===0x83){assert.equal(parameter(),9);const id=parameter();assert.ok(id>=1&&id<=5);parameter();}
   else if(op===0x94){assert.equal(parameter(),1);for(let i=0;i<3;i++)parameter();}
   else if(op===0xc0){const cmd=parameter(),n={0:2,2:2,6:3,7:1,29:3}[cmd];assert.ok(n);for(let i=0;i<n;i++)parameter();}
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
