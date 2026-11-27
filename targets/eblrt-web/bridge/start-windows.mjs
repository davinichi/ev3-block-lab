import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,mkdir,writeFile,stat,readFile} from 'node:fs/promises';
import {createBridgeServer} from './core.mjs';
import {startupBanner,existingBridgeMessage} from './startup-info.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const line of startupBanner(root))console.log(line);
const unix=p=>p.replaceAll('\\','/');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
try{
  if(/[^\x21-\x7e]/.test(root))throw Error('補助アプリを空白・日本語を含まない場所に展開してください。');
  let overrides={};try{overrides=JSON.parse(await readFile(path.join(root,'bridge.config.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const rubyRoot=path.join(root,'runtime','ruby');
  const gemRoot=path.join(rubyRoot,'lib','ruby','gems','3.3.0','gems');
  const libraries=[];for(const name of await readdir(gemRoot)){const lib=path.join(gemRoot,name,'lib');try{if((await stat(lib)).isDirectory())libraries.push(unix(lib));}catch{}}
  const rubyWrapperDir=path.join(root,'runtime','build-tools');await mkdir(rubyWrapperDir,{recursive:true});
  await writeFile(path.join(rubyWrapperDir,'ruby'),`#!/bin/bash
export RUBYOPT=--disable-gems
export RUBYLIB=${quote(libraries.join(';'))}
args=()
for arg in "$@"; do
  case "$arg" in
    /cygdrive/*) args+=("$(/usr/bin/cygpath -m "$arg")");;
    -I/cygdrive/*) args+=("-I$(/usr/bin/cygpath -m "\${arg:2}")");;
    *) args+=("$arg");;
  esac
done
exec ${quote(unix(path.join(rubyRoot,'bin','ruby.exe')))} "\${args[@]}"
`);
  const config={port:8766,sdkRoot:path.join(root,'runtime','sdk'),bashPath:'C:/cygwin64/bin/bash.exe',compilerBin:'C:/Program Files (x86)/GNU Tools ARM Embedded/5.4 2016q3/bin',rubyWrapperDir,allowedOrigins:['https://ev3rt-block-lab-private.davinichi-9576.chatgpt.site','http://127.0.0.1:8765','http://127.0.0.1:8767'],...overrides};
  const server=createBridgeServer(config);
  server.on('error',async e=>{
    if(e.code==='EADDRINUSE'){
      try{
        const r=await fetch('http://127.0.0.1:'+config.port+'/health',{headers:{'X-EV3RT-Client':'block-lab-v1'},signal:AbortSignal.timeout(5000)});
        const status=await r.json();
        if(r.ok&&status.service==='ev3-block-lab-bridge'&&status.ready){
          const result=existingBridgeMessage(status);
          for(const line of result.lines)console.log(line);
          if(!result.compatible)process.exitCode=1;
          return;
        }
      }catch{}
    }
    console.error('起動できません: '+e.message);process.exitCode=1;
  });
  server.listen(config.port,'127.0.0.1',()=>{
    console.log('EV3-RT補助アプリを起動しました。実験用サイトで「補助アプリに接続」を押してください。');
    console.log('終了するには、この画面を閉じてください。接続先: http://127.0.0.1:'+config.port);
  });
}catch(e){console.error('起動できません。配布フォルダー全体を展開したか確認してください。詳細: '+e.message);process.exitCode=1;}
