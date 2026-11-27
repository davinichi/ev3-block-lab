export const BRIDGE_URL='http://127.0.0.1:8766';
export function buildFingerprint(program,name,motorTypes){return JSON.stringify({program,name,motorTypes});}
export async function verifyBinary(buffer,expected,cryptoAPI=globalThis.crypto){
  const bytes=new Uint8Array(buffer);
  if(bytes.length<52||bytes.length!==expected.size||bytes.length>1024*1024||bytes[0]!==0x7f||String.fromCharCode(...bytes.slice(1,4))!=='ELF'||bytes[4]!==1||bytes[5]!==1||new DataView(bytes.buffer,bytes.byteOffset).getUint16(18,true)!==40||new DataView(bytes.buffer,bytes.byteOffset).getUint16(16,true)!==3)throw Error('実行ファイルの形式・サイズが一致しません。もう一度コンパイルしてください。');
  const hash=Array.from(new Uint8Array(await cryptoAPI.subtle.digest('SHA-256',buffer)),v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==expected.sha256)throw Error('実行ファイルの照合に失敗しました。');return bytes;
}
export async function chooseEV3RTDirectory(platform=globalThis.window){
  if(!platform?.showDirectoryPicker)throw Error('このブラウザーでは保存先を選べません。ChromeまたはEdgeで http://127.0.0.1:8765/ を開いてください。');
  try{return await platform.showDirectoryPicker({mode:'readwrite',id:'ev3rt-apps'});}
  catch(error){
    if(error.name==='AbortError')throw Error('保存先の選択が中断されました。まだ転送していません。選択画面が出なかった場合は、ChatGPT内のブラウザーではなくChromeまたはEdgeで http://127.0.0.1:8765/ を開き、作品を読み込んでコンパイル・転送してください。');
    if(error.name==='SecurityError'||error.name==='NotAllowedError')throw Error('ブラウザーがフォルダー選択を許可しませんでした。ChromeまたはEdgeで http://127.0.0.1:8765/ を開き、転送ボタンからやり直してください。');
    throw error;
  }
}

export async function resolveEV3RTApps(directory){
  // Only use an existing EV3RT layout. Never create folders on an unrelated drive.
  try{
    if(directory.name.toLowerCase()==='apps')return directory;
    if(directory.name.toLowerCase()==='ev3rt')return await directory.getDirectoryHandle('apps');
    return await (await directory.getDirectoryHandle('ev3rt')).getDirectoryHandle('apps');
  }catch{throw Error('EV3RTの「ev3rt/apps」が見つかりません。USBで表示されたEV3のドライブ、またはev3rt/appsフォルダーを選んでください。');}
}

export async function saveToSD(directory,name,bytes){
  if(directory.name!=='apps')throw Error('EV3のmicroSD内の「ev3rt/apps」フォルダーを選んでください。');
  if(!/^[A-Za-z0-9_-]{1,31}$/.test(name))throw Error('保存する名前が不正です。');
  const file=await directory.getFileHandle(name,{create:true}),writer=await file.createWritable();
  try{await writer.write(bytes);await writer.close();}catch(e){try{await writer.abort();}catch{}throw e;}
  const read=new Uint8Array(await (await file.getFile()).arrayBuffer());
  if(read.length!==bytes.length||read.some((v,i)=>v!==bytes[i]))throw Error('保存後の読み戻し照合に失敗しました。転送済みとは扱いません。');
  return {size:bytes.length,name,readbackVerified:true};
}

export function installEV3RTWorkbench({getProgram,getName,getMotorTypes,setBusy,isBusy,download,dialog}){
  const $=id=>document.getElementById(id);
  let connected=!!globalThis.EBLDesktop,active=false,built=null;
  const snapshot=()=>buildFingerprint(getProgram(),getName(),getMotorTypes());
  const message=(text,error=false)=>{$('ev3rtBuildStatus').textContent=text;$('ev3rtBuildStatus').className='result '+(error?'error':'success');};
  const showLog=log=>{$('ev3rtBuildLog').textContent=log??'';};
  const fresh=()=>{if(!built||built.fingerprint!==snapshot())throw Error('作品・名前・モーター設定が変更されています。もう一度コンパイルしてください。');return built;};
  function refresh(){
    const badge=$('connection');if(badge&&document.body?.dataset?.target!=='standard'){badge.textContent=globalThis.EBLDesktop?'同梱環境':connected?'補助アプリ接続済み':'補助アプリ未接続';badge.classList?.toggle('connected',connected);}
    if(!dialog.open)return;
    let current=false;try{current=!!built&&built.fingerprint===snapshot();}catch{}
    $('ev3rtBridgeConnect').disabled=active||isBusy();
    $('ev3rtCompile').disabled=active||isBusy()||!connected;
    $('ev3rtTransfer').disabled=active||isBusy()||!current;
    $('ev3rtSaveBinary').disabled=active||isBusy()||!current;
    $('ev3rtTransferMethod').disabled=active;$('ev3rtIP').disabled=active;
    for(const p of 'ABCD')$('ev3rtMotor'+p).disabled=active;
    if(built&&!current&&!active)message('作品が変更されています。転送する前に、もう一度コンパイルしてください。',true);
  }
  async function request(route,{method='GET',body,binary=false}={}){
    if(globalThis.EBLDesktop)return globalThis.EBLDesktop.request(route,{method,body,binary});
    let response;
    try{response=await fetch(BRIDGE_URL+route,{method,mode:'cors',credentials:'omit',headers:{'X-EV3RT-Client':'block-lab-v1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});}
    catch{connected=false;throw Error('PCの補助アプリに接続できません。起動しているか確認し、ブラウザーから求められた場合はローカルネットワーク接続を許可してください。');}
    if(!response.ok){let data;try{data=await response.json();}catch{}throw Error(data?.error??'補助アプリでエラーが発生しました。');}
    return binary?response.arrayBuffer():response.json();
  }
  async function operation(fn){if(active||isBusy())return;active=true;setBusy(true);refresh();try{await fn();}catch(e){message(e.message,true);}finally{active=false;setBusy(false);refresh();}}
  $('ev3rtBridgeConnect').onclick=()=>operation(async()=>{
    const status=await request('/health');if(status.service!=='ev3-block-lab-bridge'||!status.ready)throw Error('対応するEV3-RT補助アプリではありません。');
    if(status.version<13||!status.features?.includes('bounded-motor-speed'))throw Error('この補助アプリは速度制限に対応する機能版13に対応していません。「環境設定・初回準備」の更新手順に従い、このサイトのZIPを全展開して起動してください。');
    connected=true;message(globalThis.EBLDesktop?'同梱環境を確認しました。コンパイルできます。':'補助アプリに接続しました。コンパイルできます。');
  });
  $('ev3rtCompile').onclick=()=>operation(async()=>{
    built=null;showLog('');
    const program=getProgram(),name=getName(),motorTypes=getMotorTypes(),fingerprint=buildFingerprint(program,name,motorTypes);
    message('コンパイルしています…');
    const job=await request('/builds',{method:'POST',body:{program,name,motorTypes,fingerprint}});
    let status;
    for(let i=0;i<180;i++){
      status=await request('/builds/'+job.id);showLog(status.log);
      if(status.status!=='building')break;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    if(status.status!=='success')throw Error(status.error??'コンパイルの待ち時間を超えました。補助アプリを確認してください。');
    const buffer=await request('/builds/'+job.id+'/binary',{binary:true}),bytes=await verifyBinary(buffer,status);
    if(snapshot()!==fingerprint)throw Error('コンパイル中に作品が変更されました。もう一度コンパイルしてください。');
    built={...status,bytes,fingerprint};message('コンパイル完了。実行ファイルを照合しました。転送できます（'+bytes.length+' bytes）。');
  });
  $('ev3rtSaveBinary').onclick=()=>{try{const job=fresh();download(job.bytes,job.name);message('EV3-RT実行ファイルを保存しました。本体への転送はまだ完了していません。');}catch(e){message(e.message,true);}};
  $('ev3rtTransfer').onclick=()=>operation(async()=>{
    const job=fresh(),method=$('ev3rtTransferMethod').value;
    if((method==='sd'||method==='usb')&&globalThis.EBLDesktop){
      const result=await globalThis.EBLDesktop.saveSD(job.id);fresh();
      message(result.canceled?'保存を取り消しました。':method==='usb'?'USB転送と読み戻し照合が完了しました。PCでEV3ドライブを安全に取り外し、USBケーブルを抜いてから、本体のLoad App → SD cardで実行してください。':'microSDへの保存と読み戻し照合が完了しました。安全に取り外し、本体のLoad App → SD cardから選択してください。');
    }else if(method==='sd'||method==='usb'){
      const dir=await chooseEV3RTDirectory();
      fresh();await saveToSD(await resolveEV3RTApps(dir),job.name,job.bytes);
      message(method==='usb'?'USB転送と読み戻し照合が完了しました。PCでEV3ドライブを安全に取り外し、USBケーブルを抜いてから、本体のLoad App → SD cardで実行してください。':'microSDへの保存と読み戻し照合が完了しました。安全に取り外し、本体のLoad App → SD cardから選択してください。');
    }else{
      message('Bluetooth PANでEV3へ転送しています…');
      const result=await request('/builds/'+job.id+'/transfer',{method:'POST',body:{ip:$('ev3rtIP').value.trim()}});
      if(!result.received)throw Error('EV3の受信応答を確認できませんでした。');
      message('EV3から受信応答がありました。本体の「App Received」を確認してください。PAN方式は読み戻し照合に非対応です。実行は本体の中央ボタンで行います。');
    }
  });
  for(const p of 'ABCD')$('ev3rtMotor'+p).addEventListener('change',refresh);
  $('ev3rtTransferMethod').onchange=()=>{$('ev3rtPANSettings').hidden=$('ev3rtTransferMethod').value!=='pan';$('ev3rtSDSettings').hidden=$('ev3rtTransferMethod').value!=='sd';$('ev3rtUSBSettings').hidden=$('ev3rtTransferMethod').value!=='usb';};
  return {refresh,open(){refresh();},invalidate(){built=null;message(globalThis.EBLDesktop?'同梱環境でコンパイルできます。作品を変更した場合は再コンパイルしてください。':'対象に合わせて、もう一度コンパイルしてください。');refresh();}};
}
