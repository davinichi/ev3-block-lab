import path from 'node:path';
import {mkdir,readFile,writeFile,stat,rename,copyFile} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';

const hashFile=async(file,algorithm)=>{const h=createHash(algorithm);for await(const b of createReadStream(file))h.update(b);return h.digest('hex');};
export async function downloadVerified(url,file,algorithm,digest,bytes,{fallbackUrls=[],attempts=2,retryDelayMs=500,fetcher=globalThis.fetch}={}){
 try{if((!bytes||(await stat(file)).size===bytes)&&await hashFile(file,algorithm)===digest)return;}catch{}
 await mkdir(path.dirname(file),{recursive:true});
 const temporary=file+'.part',urls=[...new Set([url,...fallbackUrls])],failures=[];
 if(urls.some(value=>new URL(value).protocol!=='https:'))throw Error('HTTPS download required');
 for(let attempt=0;attempt<attempts;attempt++){
  for(const candidate of urls){
   try{
    const response=await fetcher(candidate,{signal:AbortSignal.timeout(60000)});
    if(!response.ok||!response.url.startsWith('https://')){await response.body?.cancel();throw Error('HTTP '+response.status);}
    await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary));
    if(bytes&&(await stat(temporary)).size!==bytes)throw Error('Size mismatch');
    if(await hashFile(temporary,algorithm)!==digest)throw Error('SHA mismatch');
    await rename(temporary,file);return;
   }catch(error){failures.push(new URL(candidate).hostname+': '+(error.cause?.code??error.code??error.message));}
  }
  if(attempt+1<attempts&&retryDelayMs)await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
 }
 throw Error('初回準備で '+path.basename(file)+' を取得できませんでした。\n'+failures.join('\n')+'\nネット接続を確認して再起動してください。照合済みの取得ファイルは再利用します。');
}
export const PACKAGE_MIRRORS=['https://ftp.jaist.ac.jp/pub/cygwin/','https://ftp.iij.ad.jp/pub/cygwin/'];
export async function setupTools(root,progress=console.log,onProcess=()=>{}){
 const dataDir=path.join(root,'tool-setup'),manifest=JSON.parse(await readFile(path.join(dataDir,'manifest.json'),'utf8'));
 const cygwin=path.join(root,'runtime/cygwin'),ready=path.join(cygwin,'EBLRT-READY.json');
 try{const check=JSON.parse(await readFile(ready,'utf8'));if(check.iniSha256===manifest.iniSha256){for(const name of ['bash.exe','make.exe','perl.exe','cygpath.exe'])await stat(path.join(cygwin,'bin',name));return check;}}catch{}
 if(process.platform!=='win32')throw Error('Windows x64 is required.');
 progress('初回準備：Cygwinの公式配布ツールを取得します（約54 MB）。');
 const cache=path.join(root,'tool-cache'),installer=path.join(cache,'setup-x86_64.exe');
 await downloadVerified(manifest.setupUrl,installer,'sha256',manifest.setupSha256);
 const mirrorCache=path.join(cache,encodeURIComponent(manifest.mirror).toLowerCase().replace(/%3a/g,'%3a').replace(/%2f/g,'%2f'));
 // Cygwin setup uses URL-encoded mirror directories with lowercase escapes.
 await mkdir(path.join(mirrorCache,'x86_64'),{recursive:true});
 if(await hashFile(path.join(dataDir,'setup.ini'),'sha256')!==manifest.iniSha256)throw Error('Pinned package index is damaged.');
 for(const name of ['setup.ini','setup.ini.sig'])await copyFile(path.join(dataDir,name),path.join(mirrorCache,'x86_64',name));
 let next=0,done=0;
 const worker=async()=>{while(next<manifest.packages.length){const item=manifest.packages[next++];
   if(!/^(?:x86_64|noarch)\/release\/[A-Za-z0-9_+./-]+$/.test(item.path)||item.path.includes('..'))throw Error('Invalid package path');
   const urls=[...PACKAGE_MIRRORS,manifest.mirror].map(base=>new URL(item.path,base).href);
   await downloadVerified(urls[0],path.join(mirrorCache,item.path),'sha512',item.sha512,item.bytes,{fallbackUrls:urls.slice(1)});
   progress('初回準備：ツールを取得・照合中 '+(++done)+' / '+manifest.packages.length+'（'+item.name+'）');
 }};
 await Promise.all([worker(),worker()]);
 progress('初回準備：アプリ専用のビルド環境を展開しています。');
 const args=['--quiet-mode=unattended','--no-admin','--no-shortcuts','--no-write-registry','--no-replaceonreboot','--no-version-check','--local-install','--only-site','--site',manifest.mirror,'--root',cygwin,'--local-package-dir',cache,'--packages','make,perl,coreutils,sed,grep,gawk,findutils'];
 await new Promise((resolve,reject)=>{const child=spawn(installer,args,{windowsHide:true,stdio:'ignore'});onProcess(child);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Cygwin setup failed ('+code+'). See runtime/cygwin/var/log/setup.log')));});
 for(const name of ['bash.exe','make.exe','perl.exe','cygpath.exe'])await stat(path.join(cygwin,'bin',name));
 const result={ready:true,iniSha256:manifest.iniSha256,preparedAt:new Date().toISOString(),packages:manifest.packages.map(({name,version})=>({name,version}))};
 await writeFile(ready,JSON.stringify(result,null,2));progress('初回準備が完了しました。');return result;
}
if(process.argv[2]==='--prepare')setupTools(path.resolve(process.argv[3])).catch(error=>{console.error(error);process.exitCode=1;});
