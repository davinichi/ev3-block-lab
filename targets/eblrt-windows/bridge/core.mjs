import http from 'node:http';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile,realpath,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {exportEV3RT} from '../dist/ev3rt.js';
import {BRIDGE_VERSION,BRIDGE_BUILD} from './startup-info.mjs';

export const MAX_BINARY=1024*1024;
export function inspectELF(bytes){
  if(bytes.length<52||bytes.length>MAX_BINARY||bytes[0]!==0x7f||bytes.toString('ascii',1,4)!=='ELF'||bytes[4]!==1||bytes[5]!==1||bytes.readUInt16LE(18)!==40||bytes.readUInt16LE(16)!==3)throw Error('EV3-RT用のARM ELF動的モジュールを生成できませんでした。');
  return {size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function privateIP(ip){
  if(typeof ip!=='string'||!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))throw Error('EV3のIPv4アドレスを入力してください。');
  const a=ip.split('.').map(Number);if(a.some(v=>v>255)||![10,172,192].includes(a[0])||!(a[0]===10||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168)))throw Error('EV3のローカルネットワーク内のIPアドレスを入力してください。');
  return ip;
}
export function uploadPAN(bytes,name,ip,{port=80,timeout=20000,request=http.request}={}){
  privateIP(ip);if(!/^[A-Za-z0-9_-]{1,31}$/.test(name))throw Error('保存する名前が不正です。');inspectELF(bytes);
  return new Promise((resolve,reject)=>{
    // The stock EV3RT receiver matches these header names and values literally.
    const req=request({host:ip,port,path:'/upload',method:'POST',headers:{'Content-Type':'ev3rt/app','Content-Disposition':`inline; filename="${name}"`,'Content-Length':bytes.length},timeout},res=>{
      let length=0;res.on('data',chunk=>{length+=chunk.length;if(length>65536)res.destroy(Error('EV3の応答が大きすぎます。'));});
      res.on('error',reject);res.on('end',()=>{if(res.statusCode>=200&&res.statusCode<300)resolve({received:true,readbackVerified:false,name,size:bytes.length});else reject(Error('EV3が転送を受け付けませんでした（HTTP '+res.statusCode+'）。本体でLoad App → Bluetooth PANを選んでください。'));});
    });
    req.on('timeout',()=>req.destroy(Error('EV3から応答がありません。PAN接続・IP・本体の受信待ち画面を確認してください。')));
    req.on('error',reject);req.end(bytes);
  });
}

export function runBuild(config,appFolder,{onOutput=()=>{}}={}){
  const workspace=path.join(config.sdkRoot,'sdk','workspace');
  let command,args;
  if(process.platform==='win32'){
    command=config.bashPath;
    // Values are positional arguments, never shell source. appFolder is generated internally.
    const script='set -e; export PATH="$(/usr/bin/cygpath -u "$1"):$(/usr/bin/cygpath -u "$2"):/usr/bin:/bin"; cd "$(/usr/bin/cygpath -u "$3")"; make PWD=. "app=$4"';
    args=['--noprofile','--norc','-c',script,'ev3rt-build',config.rubyWrapperDir,config.compilerBin,workspace,appFolder];
  }else{command=config.makePath??'make';args=['app='+appFolder];}
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:workspace,windowsHide:true,env:{...process.env,...config.buildEnv},stdio:['ignore','pipe','pipe']});
    let log='',finished=false;
    const timer=setTimeout(()=>{if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGKILL');},120000);
    const collect=chunk=>{log=(log+chunk.toString()).slice(-16000);onOutput(log);};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',error=>{clearTimeout(timer);finished=true;reject(Error('ビルド環境を起動できません: '+error.message));});
    child.on('close',(code,signal)=>{clearTimeout(timer);if(finished)return;if(code!==0)reject(Object.assign(Error('コンパイルに失敗しました。ビルドログを確認してください。'),{buildLog:log}));else resolve({log,signal});});
  });
}

export function createBuildService(config,{builder=runBuild,upload=uploadPAN}={}){
  const jobs=new Map();let active=false;
  const getJob=id=>{const job=jobs.get(id);if(!job)throw Error('ビルド結果が見つかりません。もう一度コンパイルしてください。');return job;};
  const ready=id=>{const job=getJob(id);if(job.status!=='success')throw Error('コンパイルが完了していません。');return job;};
  return {
    jobs,
    async health(){
      const required=['configure.rb','sdk/workspace/Makefile'];for(const file of required)await stat(path.join(config.sdkRoot,file));
      if(process.platform==='win32')for(const file of [config.bashPath,path.join(config.compilerBin,'arm-none-eabi-gcc.exe'),path.join(config.rubyWrapperDir,'ruby')])await stat(file);
      return {service:'ev3-block-lab-bridge',version:BRIDGE_VERSION,build:BRIDGE_BUILD,features:['movement','native-sync','ramp-execution-order','native-tasks','motor-profiles','motor-hold','motor-feedback','motor-speed','educational-comments','data-sensors-display','split-runtime','continuous-steering','separate-c-modules','myblock-parameter-names','myblock-function-names','bounded-motor-speed'],target:'EV3RT/HRP3',ready:true,busy:active};
    },
    async start(payload){
      if(active)throw Error('別のコンパイルが進行中です。完了を待ってください。');
      const built=exportEV3RT(payload.program,{name:payload.name,motorTypes:payload.motorTypes});
      const id=randomBytes(12).toString('hex'),appFolder='ev3lab_'+id;
      active=true;let workspace;
      try{workspace=await realpath(path.join(config.sdkRoot,'sdk','workspace'));}catch(error){active=false;throw error;}
      const dir=path.resolve(workspace,appFolder);
      if(path.dirname(dir)!==workspace)throw Error('ビルド先が不正です。');
      active=true;
      const job={id,status:'building',name:built.name,log:'コンパイルを開始しました。',createdAt:Date.now(),fingerprint:payload.fingerprint??null};
      jobs.set(id,job);
      // Bound retained source/artifacts; directories are only ever created here.
      for(const [key,value]of jobs)if(value.status!=='building'&&Date.now()-value.createdAt>3600000)jobs.delete(key);
      void (async()=>{
        try{
          await mkdir(dir);
          for(const [file,text]of Object.entries(built.files))await writeFile(path.join(dir,path.basename(file)),text);
          await unlink(path.join(workspace,'app')).catch(e=>{if(e.code!=='ENOENT')throw e;});
          const result=await builder(config,appFolder,{onOutput:log=>{job.log=log;}});
          const bytes=await readFile(path.join(workspace,'app'));
          const info=inspectELF(bytes);
          Object.assign(job,{status:'success',bytes,...info,log:result.log});
        }catch(error){Object.assign(job,{status:'error',error:error.message,log:error.buildLog??job.log});}
        finally{active=false;}
      })();
      return {id,status:job.status};
    },
    status(id){const {bytes,...job}=getJob(id);return job;},
    binary(id){return ready(id).bytes;},
    async transfer(id,ip){const job=ready(id);return upload(job.bytes,job.name,privateIP(ip));}
  };
}

async function jsonBody(req){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw Error('作品が大きすぎます。');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createBridgeServer(config,service=createBuildService(config)){
  const port=config.port??8766;
  const origins=new Set(config.allowedOrigins??[]);
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  return http.createServer(async(req,res)=>{
    try{
      if(![`127.0.0.1:${req.socket.localPort}`,`localhost:${req.socket.localPort}`].includes(req.headers.host)){json(res,403,{error:'Invalid host'});return;}
      const origin=req.headers.origin;
      if(origin&&!origins.has(origin)){json(res,403,{error:'このサイトからの接続は許可されていません。'});return;}
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS'){
        if(!origin){json(res,403,{error:'Origin required'});return;}
        res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-EV3RT-Client','Access-Control-Allow-Private-Network':'true','Access-Control-Max-Age':'300'});res.end();return;
      }
      if(req.headers['x-ev3rt-client']!=='block-lab-v1'){json(res,403,{error:'専用アプリから接続してください。'});return;}
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/health'){json(res,200,await service.health());return;}
      if(req.method==='POST'&&url.pathname==='/builds'){json(res,202,await service.start(await jsonBody(req)));return;}
      const match=url.pathname.match(/^\/builds\/([a-f0-9]{24})(\/binary|\/transfer)?$/);
      if(match){
        if(req.method==='GET'&&match[2]==='/binary'){
          const bytes=service.binary(match[1]);res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store','Content-Length':bytes.length});res.end(bytes);return;
        }
        if(req.method==='GET'&&!match[2]){json(res,200,service.status(match[1]));return;}
        if(req.method==='POST'&&match[2]==='/transfer'){const payload=await jsonBody(req);json(res,200,await service.transfer(match[1],payload.ip));return;}
      }
      json(res,404,{error:'Not found'});
    }catch(error){json(res,400,{error:error.message});}
  });
}
