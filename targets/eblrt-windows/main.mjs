import {appendFileSync,mkdirSync} from 'node:fs';
import {app,BrowserWindow,Menu,protocol,ipcMain,dialog,shell} from 'electron';
import path from 'node:path';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {setupTools} from './setup-tools.mjs';
import {runtimeConfig,toolVersions} from './runtime-config.mjs';
import {createBuildService} from './bridge/core.mjs';
import {routeRequest,writeSD,trustedSender} from './desktop-service.mjs';
import {finishTransfer} from './transfer-notification.mjs';

const trace=m=>{if(process.env.EBLRT_DEBUG)appendFileSync(path.join(app.getAppPath(),'boot.log'),m+'\n');};trace('main loaded');
process.on('uncaughtException',error=>{try{appendFileSync(path.join(root,'startup-error.txt'),String(error.stack??error)+'\n');}catch{}console.error(error);app.quit();});
app.setName('EBL-RT Windows');
const root=app.getAppPath(),uiRoot=path.join(root,'dist');
mkdirSync(path.join(root,'user-data'),{recursive:true});
app.setPath('userData',path.join(root,'user-data'));
trace('before lock');
if(!app.requestSingleInstanceLock()){app.quit();}else{
 trace('locked');let mainWindow,service,config;const children=new Set();
 app.on('second-instance',()=>{mainWindow?.show();mainWindow?.focus();});
 app.on('window-all-closed',()=>{if(mainWindow)app.quit();});
 app.on('before-quit',()=>{for(const pid of children)spawnSync(path.join(process.env.SystemRoot??'C:/Windows','System32/taskkill.exe'),['/pid',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});});
 const mime={'.wav':'audio/wav','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8','.woff2':'font/woff2'};
 const safeFile=url=>{const u=new URL(url);if(u.protocol!=='eblrt:'||u.hostname!=='app')throw Error('Unsupported page');const file=path.resolve(uiRoot,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(uiRoot+path.sep))throw Error('Invalid page');return file;};
 const externalHosts=new Set(['ev3rt-block-lab-private.davinichi-9576.chatgpt.site','nodejs.org','cygwin.com','launchpad.net','www.electronjs.org','github.com','toppers.jp','www.toppers.jp','ev3rt-git.github.io','support.microsoft.com','education.lego.com','developer.chrome.com','docs.ev3dev.org']);
 function openLink(url){
  try{const u=new URL(url);
   if(u.protocol==='https:'&&externalHosts.has(u.hostname)){shell.openExternal(u.href);return;}
   if(u.protocol==='eblrt:'&&u.hostname==='app'){
    safeFile(u.href);if(u.pathname==='/index.html'||u.pathname==='/'){mainWindow?.focus();return;}const guide=new BrowserWindow({width:1050,height:800,title:'EBL-RT ご案内',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    guide.webContents.setWindowOpenHandler(({url})=>{openLink(url);return {action:'deny'};});
    guide.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('eblrt://app/')||new URL(url).pathname==='/index.html'){e.preventDefault();openLink(url);}});guide.loadURL(u.href);
   }
  }catch{}
 }
 void app.whenReady().then(async()=>{trace('ready');
 try{
  protocol.handle('eblrt',async request=>{
   try{const file=safeFile(request.url),body=await readFile(file);return new Response(body,{headers:{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'"}});}
   catch{return new Response('Not found',{status:404});}
  });
  const preparation=new BrowserWindow({width:650,height:400,resizable:false,title:'EBL-RT Windows 0.3.6 初回準備',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(root,'setup-progress.cjs')}});
  trace('preparation created');preparation.setMenu(null);
  let preparing=true;
  preparation.on('closed',()=>{if(preparing)app.quit();});
  await preparation.loadURL('eblrt://app/setup.html');
  trace('setup page loaded');await setupTools(root,message=>{if(!preparation.isDestroyed())preparation.webContents.send('setup-progress',message);},child=>{if(child.pid)children.add(child.pid);child.once('close',()=>children.delete(child.pid));});
  trace('tools ready');preparing=false;preparation.destroy();
  trace('preparation closed');config=await runtimeConfig(root);config.onBuildProcess=child=>{if(child.pid)children.add(child.pid);child.once('close',()=>children.delete(child.pid));};
  service=createBuildService(config);
  await mkdir(app.getPath('userData'),{recursive:true});
  mainWindow=new BrowserWindow({width:1440,height:920,minWidth:1050,minHeight:700,backgroundColor:'#edf4f5',title:'EBL-RT Windows 0.3.6',webPreferences:{autoplayPolicy:'no-user-gesture-required',preload:path.join(root,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const guard=event=>{if(!trustedSender(event,mainWindow))throw Error('この操作は編集画面専用です。');};
  ipcMain.handle('eblrt:request',(event,input)=>{
   guard(event);
   if(input?.method==='POST' && /^\/builds\/[a-f0-9]{24}\/transfer$/.test(input?.route??''))
    return finishTransfer(()=>routeRequest(service,input),'pan',()=>mainWindow.webContents.send('eblrt:transfer-complete'));
   return routeRequest(service,input);
  });
  ipcMain.handle('eblrt:diagnose',async event=>{guard(event);const health=await service.health();return {ready:health.ready,tools:await toolVersions(root),compiler:'同梱ARM GCC',shell:'同梱Cygwin',node:process.versions.node,electron:process.versions.electron};});
  ipcMain.handle('eblrt:test-compile',async event=>{guard(event);return service.start({name:'EnvironmentCheck',motorTypes:{},program:{main:[{type:'tone',frequency:440,ms:1000,volume:10}],procedures:[]}});});
  ipcMain.handle('eblrt:save-sd',async(event,id)=>{
   guard(event);const job=service.status(id),bytes=service.binary(id);
   const choice=await dialog.showOpenDialog(mainWindow,{title:'EV3のUSBドライブ／microSD、またはev3rt/appsを選択（同名は上書き）',properties:['openDirectory']});
   if(choice.canceled)return {canceled:true};return finishTransfer(()=>writeSD(choice.filePaths[0],job.name,bytes),'sd',()=>mainWindow.webContents.send('eblrt:transfer-complete'));
  });
  mainWindow.webContents.on('page-title-updated',event=>{event.preventDefault();mainWindow.setTitle('EBL-RT Windows 0.3.6');});
  mainWindow.webContents.setWindowOpenHandler(({url})=>{openLink(url);return {action:'deny'};});
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(url!=='eblrt://app/index.html'){event.preventDefault();openLink(url);}});
  mainWindow.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(()=>false);
  mainWindow.webContents.session.on('will-download',(_event,item)=>item.setSaveDialogOptions({defaultPath:path.join(app.getPath('downloads'),path.basename(item.getFilename()))}));
  mainWindow.webContents.on('console-message',(_event,...args)=>{if(process.env.EBLRT_DEBUG)console.log('renderer',...args);});
  mainWindow.webContents.on('render-process-gone',(_e,detail)=>console.error('renderer stopped',detail.reason));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   {label:'アプリ',submenu:[{label:'編集画面を再読み込み',click:()=>mainWindow.reload()},{type:'separator'},{label:'終了',role:'quit'}]},
   {label:'編集',submenu:[{role:'undo',label:'元に戻す'},{role:'redo',label:'やり直す'},{type:'separator'},{role:'cut',label:'切り取り'},{role:'copy',label:'コピー'},{role:'paste',label:'貼り付け'}]},
   {label:'表示',submenu:[{role:'zoomIn',label:'拡大'},{role:'zoomOut',label:'縮小'},{role:'resetZoom',label:'標準の大きさ'}]},
   {label:'ヘルプ',submenu:[{label:'Windows試作版の使い方',click:()=>openLink('eblrt://app/windows-guide.html')},{label:'EBL-RTの差分マニュアル',click:()=>openLink('eblrt://app/manual/EBLRT-Guide-v0.34.2.html')}]}]));
  await mainWindow.loadURL('eblrt://app/index.html');
 }catch(error){try{appendFileSync(path.join(root,'startup-error.txt'),String(error.stack??error)+'\n');}catch{}dialog.showErrorBox('EBL-RT Windowsを起動できません',error.message);app.quit();}
 });
}
