import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {startupBanner,existingBridgeMessage,BRIDGE_VERSION,BRIDGE_BUILD} from '../bridge/startup-info.mjs';

test('startup banner identifies capability, build, fix and source folder',()=>{
 const text=startupBanner('C:/EBLRT/bridge9').join('\n');
 assert.ok(text.includes('機能版: '+BRIDGE_VERSION));assert.ok(text.includes(BRIDGE_BUILD));assert.ok(text.includes('C:/EBLRT/bridge9'));
 assert.match(text,/連続ステアリング修正: 対応/);
});
test('duplicate startup distinguishes old, compatible and incomplete helpers',()=>{
 const base={service:'ev3-block-lab-bridge',ready:true};
 const old=existingBridgeMessage({...base,version:8,features:['split-runtime']});
 assert.equal(old.compatible,false);assert.match(old.lines.join('\n'),/新しい版は起動していません/);
 assert.match(old.lines.join('\n'),/すでに起動中の補助アプリ: 機能版 8/);
 const current=existingBridgeMessage({...base,version:BRIDGE_VERSION,build:BRIDGE_BUILD,features:['continuous-steering','separate-c-modules','myblock-parameter-names','myblock-function-names','bounded-motor-speed']});
 assert.equal(current.compatible,true);assert.match(current.lines.join('\n'),/元の起動画面/);
 assert.equal(existingBridgeMessage({...base,version:9,features:[]}).compatible,false);
 assert.equal(existingBridgeMessage({...base,version:99,features:['continuous-steering','separate-c-modules','myblock-parameter-names','myblock-function-names','bounded-motor-speed']}).compatible,true);
 assert.equal(existingBridgeMessage({...base,version:10,features:['continuous-steering','separate-c-modules']}).compatible,false);
 assert.equal(existingBridgeMessage({...base,version:'9',features:['continuous-steering']}).compatible,false);
});
test('Windows launcher on an occupied port shows the actual old version and exits as failed',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'eblrt-launch-'));
 const server=http.createServer((req,res)=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({service:'ev3-block-lab-bridge',ready:true,version:8,features:['split-runtime']})));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await mkdir(path.join(root,'bridge'));
  await mkdir(path.join(root,'runtime/ruby/lib/ruby/gems/3.3.0/gems'),{recursive:true});
  await copyFile(new URL('../bridge/start-windows.mjs',import.meta.url),path.join(root,'bridge/start-windows.mjs'));
  await copyFile(new URL('../bridge/startup-info.mjs',import.meta.url),path.join(root,'bridge/startup-info.mjs'));
  await writeFile(path.join(root,'bridge/core.mjs'),`export {createBridgeServer} from ${JSON.stringify(new URL('../bridge/core.mjs',import.meta.url).href)};`);
  await writeFile(path.join(root,'bridge.config.json'),JSON.stringify({port:server.address().port}));
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(root,'bridge/start-windows.mjs')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
    const timer=setTimeout(()=>{child.kill();reject(Error('Launcher timed out'));},10000);
    child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,output});});
  });
  assert.equal(result.code,1,result.output);
  assert.match(result.output,new RegExp('機能版: '+BRIDGE_VERSION));assert.match(result.output,/起動中の補助アプリ: 機能版 8/);
  assert.match(result.output,/古い補助アプリの起動画面を閉じて/);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
