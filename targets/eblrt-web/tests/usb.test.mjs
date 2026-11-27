import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EV3Connection,packet,u16,u32} from '../dist/ev3.js';
class Device extends EventTarget{
 constructor(size=1024){super();this.vendorId=0x0694;this.productId=5;this.productName='EV3';this.opened=false;this.size=size;this.sent=[];const report={reportId:0,items:[{reportSize:8,reportCount:size}]};this.collections=[{usagePage:0xff00,usage:1,inputReports:[report],outputReports:[report]}];}
 async open(){this.opened=true;}async close(){this.opened=false;}
 reply(bytes,id=0){const buffer=new Uint8Array(this.size+7);buffer.set(bytes,7);const event=new Event('inputreport');Object.assign(event,{reportId:id,data:new DataView(buffer.buffer,7,this.size)});this.dispatchEvent(event);}
 async sendReport(id,data){assert.equal(id,0);assert.equal(data.length,this.size);const length=data[0]+256*data[1]+2;assert.ok(data.slice(length).every(x=>x===0));const frame=data.slice(0,length);this.sent.push(frame);await this.respond?.(frame);}
}
function setup(size){const device=new Device(size),hid=new EventTarget();hid.requestDevice=async options=>{hid.filters=options.filters;return [device];};const connection=new EV3Connection(()=>{},()=>{},{isSecureContext:true,navigator:{hid}});return {device,hid,connection};}
function fileServer(device){
 const files=new Map();let path,write=[],size,read,at;
 device.respond=frame=>{
  const id=frame[2]+256*frame[3];if(frame[4]===0){device.reply(packet(id,2,frame[5]===32?new TextEncoder().encode('V1.09E\0'):[]));return;}
  const cmd=frame[5],args=frame.slice(6);let status=0,data=[];const str=offset=>new TextDecoder().decode(args.slice(offset)).split('\0')[0];
  switch(cmd){
   case 0x9b:status=5;break;
   case 0x92:size=new DataView(args.buffer,args.byteOffset).getUint32(0,true);path=str(4);write=[];data=[1];break;
   case 0x93:assert.equal(args[0],1);write.push(...args.slice(1));if(write.length===size){files.set(path,new Uint8Array(write));status=8;}break;
   case 0x94:{read=files.get(str(2));assert.ok(read);const count=args[0]+256*args[1];at=Math.min(count,read.length);data=[...u32(read.length),2,...read.slice(0,at)];if(at===read.length)status=8;break;}
   case 0x95:{assert.equal(args[0],2);const count=args[1]+256*args[2],next=Math.min(at+count,read.length);data=[2,...read.slice(at,next)];at=next;if(at===read.length)status=8;break;}
   case 0x98:break;
   default:throw Error('Unexpected command '+cmd);
  }
  device.reply(packet(id,3,[cmd,status,...data]));
 };return files;
}
for(const size of [64,1024])test('USB '+size+' byte reports transfer, verify, launch and observe sensors without changing modes',async()=>{
 const {device,connection}=setup(size),files=fileServer(device),serveFile=device.respond;let running=false;
 device.respond=frame=>{
  if(frame[4]!==0)return serveFile(frame);
  const id=frame[2]+256*frame[3],out=new Uint8Array(frame[5]+256*frame[6]),op=frame[7];
  if(op===0x0c){out[0]=running?0x10:0x40;out[1]=running?1:0;}
  if(op===0xc0){assert.equal(frame[10],0x84);running=true;}
  if(op===2)running=false;
  if(op===0x99){out[0]=126;new DataView(out.buffer).setFloat32(4,NaN,true);}
  device.reply(packet(id,2,out));
 };
 await connection.connect('usb');const result=await connection.transferAndRun(Uint8Array.of(76,69,71,79),'Go.rbf',()=>{});
 assert.equal(running,true);assert.equal(result.started,true);assert.deepEqual(files.get(result.path),Uint8Array.of(76,69,71,79));assert.equal((await connection.readSensorSnapshot()).inputs[0].value,null);assert.equal(running,true);
 await connection.stopProgram();assert.equal(running,false);await connection.close();
});
for(const size of [64,1024])test('USB '+size+' byte reports support identity, padded replies, complete readback and overwrite',async()=>{
 const {device,hid,connection}=setup(size),files=fileServer(device);await connection.connect('usb');
 assert.deepEqual(hid.filters,[{vendorId:0x0694,productId:5,usagePage:0xff00,usage:1}]);assert.equal(await connection.ping(),'V1.09E');
 const data=Uint8Array.from({length:719},(_,i)=>i%251);assert.equal(await connection.transfer(data,'Run.rbf',()=>{}),'../prjs/EV3Lab/Run.rbf');assert.deepEqual(files.get('../prjs/EV3Lab/Run.rbf'),data);
 await connection.transfer(data.slice(0,21),'Run.rbf',()=>{});assert.deepEqual(files.get('../prjs/EV3Lab/Run.rbf'),data.slice(0,21));
 assert.equal(connection.chunkSize,size===64?52:240);await connection.close();assert.equal(device.opened,false);assert.equal(connection.connected,false);
});
test('USB unplug rejects pending requests and permits reconnection',async()=>{
 const {device,hid,connection}=setup(64);await connection.connect('usb');const pending=connection.request(0,[0],100);const event=new Event('disconnect');event.device=device;hid.dispatchEvent(event);
 await assert.rejects(pending,/USB/);assert.equal(connection.pending.size,0);assert.equal(connection.connected,false);
 await connection.connect('usb');device.respond=f=>device.reply(packet(f[2]+256*f[3],2,[1]));assert.equal((await connection.request(0,[0]))[5],1);await connection.close();
});
test('USB rejects bootloader, unsupported descriptors and cancelled selection before opening',async()=>{
 for(const invalid of ['bootloader','report','cancel']){const {device,hid,connection}=setup(64);if(invalid==='bootloader')device.productId=6;if(invalid==='report')device.collections=[];if(invalid==='cancel')hid.requestDevice=async()=>[];await assert.rejects(connection.connect('usb'));assert.equal(device.opened,false);assert.equal(device.sent.length,0);assert.equal(connection.connected,false);}
});
test('USB invalid replies, timeout and send failure disconnect without leaving pending operations',async()=>{
 for(const mode of ['invalid','timeout','write']){const {device,connection}=setup(64);await connection.connect('usb');if(mode==='invalid')device.respond=()=>device.reply(new Uint8Array([255,255,0,0,2]));if(mode==='write')device.respond=()=>{throw Error('unplugged');};await assert.rejects(connection.request(0,[0],20));assert.equal(connection.pending.size,0);assert.equal(connection.connected,false);assert.equal(device.opened,false);}
});
test('USB short reports reject long paths before writing and verify readback mismatch',async()=>{
 const {device,connection}=setup(64);fileServer(device);await connection.connect('usb');await assert.rejects(connection.transfer(new Uint8Array([1]),'x'.repeat(31)+'.rbf',()=>{},'x'.repeat(31)),/短く/);assert.equal(device.sent.length,0);
 const original=connection.readFile.bind(connection);connection.readFile=async path=>{const data=await original(path);data[0]^=255;return data;};await assert.rejects(connection.transfer(new Uint8Array([1]),'Run.rbf',()=>{}),/照合/);await connection.close();
});
test('USB requires secure context and WebHID, and ignores padding and unexpected report ids',async()=>{
 await assert.rejects(new EV3Connection(()=>{},()=>{},{isSecureContext:false,navigator:{hid:{}}}).connect('usb'));
 await assert.rejects(new EV3Connection(()=>{},()=>{},{isSecureContext:true,navigator:{}}).connect('usb'),/WebHID/);
 const {device,connection}=setup(64);await connection.connect('usb');device.respond=f=>{device.reply(new Uint8Array(64));device.reply(packet(f[2]+256*f[3],2,[99]),1);device.reply(packet(f[2]+256*f[3],2,[42]));};assert.equal((await connection.request(0,[0]))[5],42);await connection.close();
});

test('Bluetooth remains the default connection and can be selected after USB',async()=>{
 const {device,connection}=setup(64);await connection.connect('usb');await connection.close();let endRead,opened=false;
 const port={open:async options=>{assert.equal(options.baudRate,115200);opened=true;},close:async()=>{opened=false;},getInfo:()=>({}),readable:{getReader:()=>({read:()=>new Promise(r=>endRead=r),cancel:async()=>endRead({done:true}),releaseLock(){}})},writable:{getWriter:()=>({write:async bytes=>connection.receive(packet(bytes[2]+256*bytes[3],2,[7])),releaseLock(){}})}};
 connection.platform.navigator.serial={requestPort:async()=>port};await connection.connect();assert.equal(connection.transport,'bluetooth');assert.equal(opened,true);assert.equal((await connection.request(0,[0]))[5],7);await connection.close();assert.equal(opened,false);assert.equal(device.opened,false);
});
test('USB denied open leaves the connection closed',async()=>{
 const {device,connection}=setup(64);device.open=async()=>{throw Error('permission denied');};await assert.rejects(connection.connect('usb'),/USB接続できません/);assert.equal(connection.connected,false);assert.equal(device.sent.length,0);
});

for(const size of [64,1024])test('USB '+size+' byte transfer signals completion only after a byte-identical readback',async()=>{
 const {device,connection}=setup(size),files=fileServer(device);await connection.connect('usb');const data=Uint8Array.from({length:513},(_,i)=>i%253);
 const result=await connection.transferWithSignal(data,'Done.rbf',()=>{});assert.equal(result.soundError,null);assert.deepEqual(files.get(result.path),data);
 assert.equal(device.sent.at(-1)[4],0);assert.equal(device.sent.filter(frame=>frame[4]===0).length,1);assert.equal(device.sent.at(-2)[5],0x95);
 const read=connection.readFile.bind(connection);connection.readFile=async path=>{const bytes=await read(path);bytes[0]^=255;return bytes;};
 const before=device.sent.filter(frame=>frame[4]===0).length;await assert.rejects(connection.transferWithSignal(data,'Done.rbf',()=>{}),/照合/);assert.equal(device.sent.filter(frame=>frame[4]===0).length,before);await connection.close();
});
