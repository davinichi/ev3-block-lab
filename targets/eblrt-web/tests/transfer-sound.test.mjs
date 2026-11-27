import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTransferSound} from '../dist/transfer-sound.js';
import {installEV3RTWorkbench} from '../dist/ev3rt-workbench.js';

class FakeAudioContext{
 static starts=[];
 state='suspended';currentTime=12;destination={};
 resume(){this.state='running';return Promise.resolve();}
 createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},disconnect(){},start(time){FakeAudioContext.starts.push(time);},stop(){}};}
 createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
}
test('completion sound is armed first and schedules two short tones after a delay',async()=>{
 FakeAudioContext.starts=[];const sound=createTransferSound(FakeAudioContext);
 assert.equal(await sound.play(),false);assert.equal(sound.arm(),true);
 await Promise.resolve();assert.equal(await sound.play(),true);
 assert.equal(FakeAudioContext.starts.length,2);assert.ok(FakeAudioContext.starts[1]>FakeAudioContext.starts[0]);
});
test('unsupported or blocked audio is nonfatal',async()=>{
 assert.equal(createTransferSound(null).arm(),false);
 const sound=createTransferSound(class {state='suspended';resume(){return Promise.reject(Error('blocked'));}});
 sound.arm();assert.equal(await sound.play(),false);
});
test('workbench rings only after verified USB save or positive PAN receipt',async t=>{
 for(const scenario of ['usb','pan','cancel','mismatch','no-receipt','network-error','muted'])await t.test(scenario,async()=>{
  const previous=Object.fromEntries(['document','window','localStorage','fetch','AudioContext'].map(k=>[k,globalThis[k]]));
  try{
   const nodes=new Map();globalThis.document={getElementById(id){if(!nodes.has(id))nodes.set(id,{checked:true,value:id==='ev3rtTransferMethod'?'pan':id==='ev3rtIP'?'10.0.10.1':'',addEventListener(){}});return nodes.get(id);}};
   const el=id=>document.getElementById(id);globalThis.localStorage={getItem(){return scenario==='muted'?'off':null;},setItem(){}};
   FakeAudioContext.starts=[];globalThis.AudioContext=FakeAudioContext;
   const bytes=new Uint8Array(256);bytes.set([0x7f,69,76,70,1,1,1]);new DataView(bytes.buffer).setUint16(16,3,true);new DataView(bytes.buffer).setUint16(18,40,true);
   const info={id:'a'.repeat(24),status:'success',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
   let written=false,readback=false;
   globalThis.window={showDirectoryPicker:async()=>{
    if(scenario==='cancel')throw Error('User cancelled');
    return {name:'apps',getFileHandle:async()=>({createWritable:async()=>({write:async()=>{written=true;},close:async()=>{},abort:async()=>{}}),getFile:async()=>({arrayBuffer:async()=>{readback=true;return scenario==='mismatch'?new Uint8Array(256).buffer:bytes.buffer;}})})};
   }};
   globalThis.fetch=async url=>{
    if(url.endsWith('/transfer')){
     assert.equal(FakeAudioContext.starts.length,0,'no tone before receiver response');
     if(scenario==='network-error')throw Error('offline');
     return {ok:true,json:async()=>({received:scenario!=='no-receipt'})};
    }
    return {ok:true,arrayBuffer:async()=>bytes.buffer,json:async()=>url.endsWith('/health')?{service:'ev3-block-lab-bridge',ready:true,version:13,features:['myblock-function-names','bounded-motor-speed']}:info};
   };
   installEV3RTWorkbench({getProgram:()=>({main:[]}),getName:()=>'Lesson',getMotorTypes:()=>({}),setBusy(){},isBusy:()=>false,download(){},dialog:{open:true}});
   await el('ev3rtBridgeConnect').onclick();await el('ev3rtCompile').onclick();assert.equal(FakeAudioContext.starts.length,0);
   el('ev3rtTransferMethod').value=['usb','cancel','mismatch'].includes(scenario)?'sd':'pan';
   await el('ev3rtTransfer').onclick();await Promise.resolve();
   const succeeded=['usb','pan'].includes(scenario);assert.equal(FakeAudioContext.starts.length,succeeded?2:0);
   if(scenario==='usb'){assert.ok(written&&readback);assert.match(el('ev3rtBuildStatus').textContent,/読み戻し照合が完了/);}
   if(['cancel','mismatch','no-receipt','network-error'].includes(scenario))assert.match(el('ev3rtBuildStatus').className,/error/);
  }finally{for(const [k,v]of Object.entries(previous)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
 });
});
