import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createBridgeServer,createBuildService,inspectELF,privateIP,uploadPAN} from '../bridge/core.mjs';
import {buildFingerprint,verifyBinary,saveToSD} from '../dist/ev3rt-workbench.js';

const elf=()=>{const b=Buffer.alloc(256);b.set([0x7f,69,76,70,1,1,1]);b.writeUInt16LE(3,16);b.writeUInt16LE(40,18);return b;};
const payload={name:'Lesson',program:{main:[{type:'waitSeconds',seconds:.01}],procedures:[]},motorTypes:{}};
async function temporary(t){const dir=await mkdtemp(path.join(tmpdir(),'ev3rt-test-'));t.after(async()=>{if(!dir.startsWith(path.join(tmpdir(),'ev3rt-test-')))throw Error('Unexpected test path');await rm(dir,{recursive:true,force:true});});return dir;}
async function waitJob(service,id){for(let i=0;i<100;i++){const s=service.status(id);if(s.status!=='building')return s;await new Promise(r=>setTimeout(r,10));}throw Error('Job did not finish');}
async function listen(t,server){server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));return server.address().port;}

test('ELF validation accepts only bounded little-endian ARM dynamic modules and verifies browser hash',async()=>{
 const b=elf(),info=inspectELF(b);assert.equal(info.size,256);
 await verifyBinary(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),info);
 await assert.rejects(verifyBinary(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),{...info,sha256:'bad'}),/照合/);
 for(const offset of [0,4,5,16,18]){const bad=Buffer.from(b);bad[offset]=0;assert.throws(()=>inspectELF(bad),/ARM ELF/);}
 assert.throws(()=>inspectELF(Buffer.alloc(1024*1024+1)));
});

test('build jobs use generated C, serialize the SDK and retain immutable artifacts',async t=>{
 const dir=await temporary(t),workspace=path.join(dir,'sdk/workspace');await mkdir(workspace,{recursive:true});
 let release;const gate=new Promise(r=>release=r);
 const service=createBuildService({sdkRoot:dir},{builder:async(config,folder,{onOutput})=>{
   assert.match(folder,/^ev3lab_[a-f0-9]{24}$/);
   assert.match(await readFile(path.join(workspace,folder,'app.c'),'utf8'),/void main_task/);
   assert.match(await readFile(path.join(workspace,folder,'app.c'),'utf8'),/#include "ebl_rt_runtime.h"/);
   assert.match(await readFile(path.join(workspace,folder,'ebl_rt_runtime.h'),'utf8'),/void lab_poll/);
   assert.match(await readFile(path.join(workspace,folder,'ebl_rt_runtime.c'),'utf8'),/void lab_poll\(void\) \{/);
   assert.ok(await readFile(path.join(workspace,folder,'ebl_myblocks.c'),'utf8'));
   onOutput('building');await gate;await writeFile(path.join(workspace,'app'),elf());return {log:'complete'};
 }});
 const job=await service.start(payload);await assert.rejects(service.start(payload),/進行中/);release();
 const status=await waitJob(service,job.id);assert.equal(status.status,'success');assert.equal(status.size,256);assert.ok(!('bytes'in status));
 await writeFile(path.join(workspace,'app'),'changed later');assert.deepEqual(service.binary(job.id),elf());
 await assert.rejects(service.start({...payload,program:{main:[{type:'led',color:1,mode:'pulse'}],procedures:[]}}),/公開API/);
});

test('failed compilation never exposes an earlier executable',async t=>{
 const dir=await temporary(t),workspace=path.join(dir,'sdk/workspace');await mkdir(workspace,{recursive:true});await writeFile(path.join(workspace,'app'),elf());
 const service=createBuildService({sdkRoot:dir},{builder:async()=>{throw Object.assign(Error('compiler error'),{buildLog:'error detail'});}});
 const job=await service.start(payload),status=await waitJob(service,job.id);assert.equal(status.status,'error');assert.equal(status.log,'error detail');assert.throws(()=>service.binary(job.id),/完了/);
 await assert.rejects(readFile(path.join(workspace,'app')),/ENOENT/);
});

test('bridge rejects unrelated origins, rebinding hosts and simple cross-site requests',async t=>{
 const allowed='https://private.example',service={health:async()=>({ready:true}),start:async()=>({id:'a'.repeat(24)}),status:()=>({status:'success'}),binary:()=>elf()};
 const server=createBridgeServer({port:0,allowedOrigins:[allowed]},service),port=await listen(t,server),base='http://127.0.0.1:'+port;
 assert.equal((await fetch(base+'/health',{headers:{Origin:'https://other.example','X-EV3RT-Client':'block-lab-v1'}})).status,403);
 assert.equal((await fetch(base+'/health')).status,403);
 const hostStatus=await new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:'/health',headers:{Host:'evil.example','X-EV3RT-Client':'block-lab-v1'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);});
 assert.equal(hostStatus,403);
 const preflight=await fetch(base+'/builds',{method:'OPTIONS',headers:{Origin:allowed,'Access-Control-Request-Method':'POST'}});
 assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),allowed);assert.equal(preflight.headers.get('access-control-allow-private-network'),'true');
 const health=await fetch(base+'/health',{headers:{Origin:allowed,'X-EV3RT-Client':'block-lab-v1'}});assert.equal(health.status,200);
});

test('Bluetooth PAN sends the official protocol and reports receiver response without claiming readback',async t=>{
 const bytes=elf();let received;
 const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);received={method:req.method,url:req.url,headers:req.rawHeaders,bytes:Buffer.concat(chunks)};res.writeHead(200).end('OK');});
 const port=await listen(t,server);
 const result=await uploadPAN(bytes,'Lesson','10.0.10.1',{request:(options,callback)=>http.request({...options,host:'127.0.0.1',port},callback)});
 assert.equal(result.received,true);assert.equal(result.readbackVerified,false);assert.equal(received.method,'POST');assert.equal(received.url,'/upload');assert.deepEqual(received.bytes,bytes);
 assert.ok(received.headers.includes('Content-Type'));assert.ok(received.headers.includes('ev3rt/app'));assert.ok(received.headers.includes('inline; filename="Lesson"'));
 for(const ip of ['127.0.0.1','8.8.8.8','169.254.169.254','10.0.0.999','10.0.0.1/path'])assert.throws(()=>privateIP(ip));
 for(const ip of ['10.0.10.1','192.168.1.5','172.16.0.2'])assert.equal(privateIP(ip),ip);
});

test('Bluetooth PAN errors do not report a successful transfer',async t=>{
 const server=http.createServer((req,res)=>{req.resume();req.on('end',()=>res.writeHead(400).end('No'));}),port=await listen(t,server);
 await assert.rejects(uploadPAN(elf(),'Lesson','10.0.10.1',{request:(o,cb)=>http.request({...o,host:'127.0.0.1',port},cb)}),/受け付けません/);
});

test('USB SD writes are read back and mismatches prevent success',async()=>{
 let written;
 const directory={name:'apps',getFileHandle:async name=>({createWritable:async()=>({write:async bytes=>{written=Uint8Array.from(bytes);},close:async()=>{},abort:async()=>{}}),getFile:async()=>({arrayBuffer:async()=>written.buffer})})};
 const result=await saveToSD(directory,'Lesson',elf());assert.equal(result.readbackVerified,true);
 await assert.rejects(saveToSD({...directory,name:'wrong'},'Lesson',elf()),/ev3rt\/apps/);
 const bad={name:'apps',getFileHandle:async()=>({createWritable:async()=>({write:async()=>{},close:async()=>{}}),getFile:async()=>({arrayBuffer:async()=>new Uint8Array([1]).buffer})})};
 await assert.rejects(saveToSD(bad,'Lesson',elf()),/照合/);
});

test('build fingerprint changes for block edits, names and motor configuration',()=>{
 const p=payload.program,a=buildFingerprint(p,'A',{B:'large'});
 assert.notEqual(a,buildFingerprint(p,'B',{B:'large'}));assert.notEqual(a,buildFingerprint(p,'A',{B:'medium'}));
 assert.notEqual(a,buildFingerprint({...p,main:[{type:'waitSeconds',seconds:2}]},'A',{B:'large'}));
});
