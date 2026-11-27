import {mkdir,readFile,writeFile,rename,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {inspectELF} from './bridge/core.mjs';
export function trustedSender(event,mainWindow){return event.sender===mainWindow?.webContents&&event.senderFrame===mainWindow.webContents.mainFrame&&event.senderFrame.url.startsWith('eblrt://app/');}
export async function routeRequest(service,input){
 const {route,method='GET',body}=input??{};
 if(typeof route!=='string'||!['GET','POST'].includes(method))throw Error('アプリの要求が不正です。');
 if(JSON.stringify(body??null).length>2*1024*1024)throw Error('作品が大きすぎます。');
 if(route==='/health'&&method==='GET')return service.health();
 if(route==='/builds'&&method==='POST')return service.start(body);
 const match=route.match(/^\/builds\/([a-f0-9]{24})(\/binary|\/transfer)?$/);
 if(match){
  if(method==='GET'&&match[2]==='/binary')return service.binary(match[1]);
  if(method==='GET'&&!match[2])return service.status(match[1]);
  if(method==='POST'&&match[2]==='/transfer')return service.transfer(match[1],body?.ip);
 }
 throw Error('対応していないアプリ操作です。');
}
export async function writeSD(directory,name,bytes){
 const leaf=path.basename(directory).toLowerCase();
 if(leaf!=='apps')directory=leaf==='ev3rt'?path.join(directory,'apps'):path.join(directory,'ev3rt','apps');
 if(path.basename(directory).toLowerCase()!=='apps'||path.basename(path.dirname(directory)).toLowerCase()!=='ev3rt')throw Error('EV3ドライブまたはev3rt/appsフォルダーを選んでください。');
 try{if(!(await stat(directory)).isDirectory())throw Error();}catch{throw Error('EV3RTのev3rt/appsが見つかりません。EV3ドライブまたはev3rt/appsフォルダーを選んでください。');}
 if(!/^[A-Za-z0-9_-]{1,31}$/.test(name))throw Error('保存名が不正です。');
 inspectELF(bytes);await stat(directory);
 const target=path.join(directory,name),temp=target+'.eblrt-tmp';let created=false;
 try{
  await writeFile(temp,bytes,{flag:'wx'});created=true;
  const saved=await readFile(temp);if(!saved.equals(bytes))throw Error('保存後の読み戻し照合に失敗しました。');
  await rename(temp,target);
  const final=await readFile(target);if(!final.equals(bytes))throw Error('転送ファイルの照合に失敗しました。');
  return {name,size:bytes.length,readbackVerified:true};
 }catch(e){if(created)await unlink(temp).catch(()=>{});throw e;}
}
