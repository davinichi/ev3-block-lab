import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EV3Connection,packet,constant,globalVar,zstr,u32} from '../dist/ev3.js';
import {sensorReading} from '../dist/sensor-monitor.js';

function brick({running=false,failReadback=false,failStart=false,soundFailure=false}={}){
 const connection=new EV3Connection(),calls=[],files=new Map();let writing,bytes=[],reading,at=0;
 connection.port={};
 connection.system=async(cmd,args)=>{
  calls.push({system:cmd});const str=offset=>new TextDecoder().decode(Uint8Array.from(args.slice(offset))).split('\0')[0];
  if(cmd===0x9b)return{status:5,data:new Uint8Array()};
  if(cmd===0x92){writing=str(4);bytes=[];return {status:0,data:Uint8Array.of(1)};}
  if(cmd===0x93){bytes.push(...args.slice(1));files.set(writing,Uint8Array.from(bytes));return {status:0,data:Uint8Array.of(1)};}
  if(cmd===0x94){reading=files.get(str(2));at=Math.min(args[0]+256*args[1],reading.length);const out=reading.slice(0,at);if(failReadback)out[0]^=1;return {status:at===reading.length?8:0,data:Uint8Array.from([...u32(reading.length),2,...out])};}
  if(cmd===0x95){const next=Math.min(at+args[1]+256*args[2],reading.length),out=reading.slice(at,next);at=next;return {status:at===reading.length?8:0,data:Uint8Array.from([2,...out])};}
  if(cmd===0x98)return {status:0,data:new Uint8Array()};throw Error('Unexpected system command');
 };
 connection.request=async(type,payload)=>{
  calls.push({type,payload:[...payload]});assert.equal(type,0);
  const code=payload.slice(2),n=payload[0]+256*payload[1];
  if(code[0]===0x0c)return packet(1,2,[running?0x10:0x40,failStart?2:0]);
  if(code[0]===0xc0){running=!failStart;return packet(1,2,new Uint8Array(n));}
  if(code[0]===0x94){if(soundFailure)throw Error('sound unavailable');return packet(1,2,[]);}
  if(code[0]===2){running=false;return packet(1,2,[]);}throw Error('Unexpected direct command');
 };
 return {connection,calls,files};
}
test('transfer-and-run verifies every byte before loading the exact file into USER_SLOT and starting it',async()=>{
 const {connection,calls,files}=brick(),data=Uint8Array.from({length:501},(_,i)=>i%251);
 const result=await connection.transferAndRun(data,'Line.rbf',()=>{},'Class1');assert.equal(result.started,true);assert.equal(result.path,'../prjs/Class1/Line.rbf');assert.deepEqual(files.get(result.path),data);
 const launch=calls.findIndex(c=>c.payload?.[2]===0xc0);assert.ok(launch>calls.findLastIndex(c=>c.system===0x95||c.system===0x94));
 assert.deepEqual(calls[launch].payload,[8,0,0xc0,8,1,0x84,...zstr(result.path),...globalVar(0),...globalVar(4),3,1,...globalVar(0),...globalVar(4),0]);
 await connection.stopProgram();assert.deepEqual(calls.at(-1).payload,[0,0,2,1,0xa3,0,15,1]);
});
test('readback mismatch, running program and invalid paths never launch or replace a running image',async()=>{
 for(const options of [{failReadback:true},{running:true}]){
  const {connection,calls}=brick(options);await assert.rejects(connection.transferAndRun(Uint8Array.of(1,2),'Test.rbf',()=>{}));assert.equal(calls.some(c=>c.payload?.[2]===0xc0),false);if(options.running)assert.equal(calls.some(c=>c.system),false);
 }
 const {connection,calls}=brick();await assert.rejects(connection.startProgram('../prjs/../../bad.rbf'));assert.equal(calls.length,0);
});
test('failed start preserves verified destination; sound failure alone permits a verified program to start',async()=>{
 const failed=brick({failStart:true});await assert.rejects(failed.connection.transferAndRun(Uint8Array.of(1),'Test.rbf',()=>{}),e=>e.verifiedPath==='../prjs/EV3Lab/Test.rbf'&&/実行エラー/.test(e.message));
 const sound=brick({soundFailure:true});const result=await sound.connection.transferAndRun(Uint8Array.of(1),'Test.rbf',()=>{});assert.equal(result.started,true);assert.match(result.soundError,/sound/);
});
test('sensor snapshot uses KEEP mode, accepts absent inputs, and reads signed encoders only for actual motors',async()=>{
 const connection=new EV3Connection(),requests=[];
 connection.request=async(type,payload)=>{
  requests.push(payload);assert.equal(type,0);const n=payload[0];const out=new Uint8Array(n),view=new DataView(out.buffer);
  if(n===8){const p=requests.length-1;assert.deepEqual(payload,[8,0,0x99,5,0,p,0x60,0x61,0x9d,0,p,0,...constant(-1),0x64]);out[0]=[30,29,16,126][p];out[1]=[0,2,0,0][p];view.setFloat32(4,[23.5,5,1,NaN][p],true);}
  else{assert.equal(n,24);for(let i=0;i<4;i++){out[i*2]=[7,8,126,7][i];view.setInt32(8+i*4,[-90,360,0,720][i],true);}}
  return packet(1,2,out);
 };
 const r=await connection.readSensorSnapshot();assert.equal(requests.length,5);assert.deepEqual(r.inputs.map(x=>x.value),[23.5,5,1,null]);assert.deepEqual(r.motors.map(x=>x.value),[-90,360,null,720]);assert.ok(requests.every(p=>p.length+5<=64));
 assert.deepEqual(sensorReading(r.inputs[0]),{label:'超音波・距離',text:'23.5 cm'});assert.equal(sensorReading(r.inputs[1]).text,'赤（5）');assert.equal(sensorReading(r.inputs[2]).text,'押されている');assert.equal(sensorReading(r.inputs[3]).text,'—');assert.equal(sensorReading({type:29,mode:0,value:42}).text,'42 %');
});
test('direct monitor and start reject bad replies and oversized USB commands before sending',async()=>{
 const {connection,calls}=brick();connection.transport='usb';connection.usbReports={outputSize:64,inputSize:64};await assert.rejects(connection.transferAndRun(Uint8Array.of(1),'P'.repeat(31)+'.rbf',()=>{},'F'.repeat(31)),/短く/);assert.equal(calls.length,0);
 connection.request=async()=>packet(1,5,[]);await assert.rejects(connection.programStatus(),/受け付け/);connection.request=async()=>packet(1,2,[0]);await assert.rejects(connection.readSensorSnapshot(),/受け付け/);
});
