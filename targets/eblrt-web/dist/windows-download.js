export async function verifyPart(bytes,part,cryptoAPI=globalThis.crypto){
 if(bytes.byteLength!==part.bytes)throw Error('データのサイズが一致しません。もう一度取得してください。');
 const digest=Array.from(new Uint8Array(await cryptoAPI.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(digest!==part.sha256)throw Error('データの照合に失敗しました。もう一度取得してください。');
}
export function validateManifest(manifest){
 if(manifest.name!=='EBL-RT-Windows-0.3.6.zip'||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<=0||manifest.bytes>600*1024*1024||!Array.isArray(manifest.parts)||manifest.parts.length>40||!manifest.parts.length)throw Error('ダウンロード情報が不正です。');
 let total=0;manifest.parts.forEach((part,index)=>{if(part.path!==`downloads/windows-0.3.6/part-${String(index+1).padStart(3,'0')}.bin`||!Number.isSafeInteger(part.bytes)||part.bytes<=0||part.bytes>20*1024*1024||!/^[a-f0-9]{64}$/.test(part.sha256))throw Error('分割ファイル情報が不正です。');total+=part.bytes;});
 if(total!==manifest.bytes||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw Error('ZIP情報が一致しません。');return manifest;
}
if(typeof document!=='undefined'){
 const $=id=>document.getElementById(id),prepare=$('prepareWindows'),cancel=$('cancelWindows'),save=$('saveWindows'),status=$('downloadStatus'),progress=$('downloadProgress');let manifest,controller,objectURL;
 try{const r=await fetch('downloads/windows-0.3.6.json',{cache:'no-store'});if(!r.ok)throw Error('ダウンロード情報を取得できませんでした。');manifest=validateManifest(await r.json());$('downloadInfo').textContent=`Windows 10／11・64bit向け実験版 0.3.6。ZIPサイズ：約${Math.ceil(manifest.bytes/1024/1024)} MB。画面改訂：2026-11-27（UI toolbar3 / setup1 / green1 / green1）。`;status.textContent='「Windows版ZIPを取得」を押すと、このサイトから取得・照合します。';prepare.disabled=false;}catch(e){status.textContent=e.message;status.classList.add('error');}
 cancel.onclick=()=>controller?.abort();
 prepare.onclick=async()=>{
  prepare.disabled=true;cancel.hidden=false;save.hidden=true;progress.hidden=false;progress.value=0;status.classList.remove('error');controller=new AbortController();if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}
  try{const buffers=[];let received=0;for(let i=0;i<manifest.parts.length;i++){
   status.textContent=`取得・照合中 ${i+1} / ${manifest.parts.length}…`;
   const part=manifest.parts[i],r=await fetch(part.path,{signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error('取得に失敗しました。通信状態を確認してやり直してください。');const bytes=await r.arrayBuffer();await verifyPart(bytes,part);buffers.push(bytes);received+=bytes.byteLength;progress.value=received/manifest.bytes*100;
  }
  if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
  objectURL=URL.createObjectURL(new Blob(buffers,{type:'application/zip'}));save.href=objectURL;save.download=manifest.name;save.hidden=false;status.textContent='全ファイルの照合が完了しました。「ZIPを保存」を押し、保存後にすべて展開してください。';
  }catch(e){status.textContent=e.name==='AbortError'?'取得を中止しました。もう一度取得できます。':e.message;status.classList.add('error');}
  finally{prepare.disabled=false;cancel.hidden=true;controller=null;}
 };
 window.addEventListener('pagehide',()=>{controller?.abort();if(objectURL)URL.revokeObjectURL(objectURL);});
}
