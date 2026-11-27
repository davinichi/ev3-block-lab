import {createCompletionSound} from './desktop-audio.js';
import {verifyBinary} from './ev3rt-workbench.js';
await import('./i18n-bootstrap.js?v=classroom-20261125-final');
if(!globalThis.EBLDesktop)throw Error('Windowsアプリから起動してください。');
const $=id=>document.getElementById(id);
document.body.classList.add('desktop-app');

// Keep one student-facing entry point, shared with the EBL layout.
const desktopTools=document.createElement('div');
desktopTools.className='menu-group desktop-menu-tools';
desktopTools.innerHTML='<span class="menu-heading">Windows版の環境・確認</span><button id="desktopDiagnose" type="button">環境診断</button><button id="desktopSoundTest" type="button">完了音を試す</button><a href="windows-guide.html" target="_blank" rel="noopener">Windows版の使い方</a>';
document.querySelector('#fileMenu .menu-group').after(desktopTools);
const soundStatus=document.createElement('p');
soundStatus.id='desktopSoundStatus';soundStatus.className='micro desktop-sound-status';
soundStatus.setAttribute('role','status');soundStatus.setAttribute('aria-live','polite');
soundStatus.hidden=true;
document.querySelector('#ev3rtDialog').append(soundStatus);
const setSoundStatus=text=>{soundStatus.textContent=text;soundStatus.hidden=false;};
const playCompletionSound=createCompletionSound();
async function notifyCompletionSound() {
 try { await playCompletionSound(); setSoundStatus('完了音の再生を開始しました。'); }
 catch(error) { setSoundStatus('音を再生できません。PCの音量・出力先を確認してください。'+(error.message??'')); }
}
EBLDesktop.onTransferComplete(()=>{void notifyCompletionSound();});
$('desktopSoundTest').onclick=()=>{if($('connectionPanel').hidden)$('toggleConnectionPanel').click();$('fileMenu').open=false;void notifyCompletionSound();};

const showDesktopTarget=()=>{
 const rt=document.body.dataset.target==='ev3rt';
 const english=$('uiLanguage').value==='en';
 const manualBase=rt?'manual/EBLRT-Guide-v0.34.3':english?'manual/EV3-Block-Lab-Manual-v0.25.6-en':'manual/EBL-Manual-v0.25.6';
 $('manualDownload').href=manualBase+'.pdf';$('manualDownload').download=manualBase.split('/').pop()+'.pdf';
 $('manualDownload').title=rt?'EBL-RT最新版ガイド v0.34.2 / 全11ページ':'標準EBLのブロック命令マニュアル';
 $('manualHtml').href=manualBase+'.html';

 document.querySelector('.badge').textContent='Windows '+EBLDesktop.version+' / '+(rt?'EBL-RT':'EBL')+' 0.34.3 / UI toolbar3 / setup1'+' / green1';
 if(!rt){$('targetDescription').textContent='Windows版の標準EV3モードは.rbf保存に対応しています。本体への標準転送はChrome／EdgeのEBLを使用してください。';$('panelTargetTitle').textContent='標準EV3用.rbfの保存';}
};
$('programTarget').addEventListener('change',showDesktopTarget);$('uiLanguage').addEventListener('change',showDesktopTarget);showDesktopTarget();
$('help').onclick=()=>window.open('windows-guide.html','_blank');

document.querySelector('footer span:nth-child(2)').textContent='Windows x64 試作版 · 編集データはこのアプリに自動保存';
const d=document.createElement('dialog');d.className='desktop-diagnostics';
d.innerHTML='<h2>同梱環境の診断</h2><p>Cygwinは初回に自動準備します。Node.js・ARM GCC・Rubyは同梱済みです。</p><pre id="desktopTools"></pre><p>試験コンパイルは音だけのプログラムを作ります。EV3への転送・実行は行いません。編集中の作品は変更しません。</p><button id="desktopTest" class="primary">試験コンパイル（音だけ）</button><pre id="desktopTestResult" role="status"></pre><button id="desktopDiagnosticClose">閉じる</button>';
document.body.append(d);
$('desktopDiagnosticClose').onclick=()=>d.close();
$('desktopDiagnose').onclick=async()=>{$('fileMenu').open=false;d.showModal();try{const data=await EBLDesktop.diagnose();$('desktopTools').textContent='同梱環境：'+(data.ready?'準備済み':'要確認')+'\n'+JSON.stringify(data.tools,null,2)+'\nNode.js '+data.node+' / Electron '+data.electron;}catch(e){$('desktopTools').textContent=e.message;}};
$('desktopTest').onclick=async()=>{
 $('desktopTest').disabled=true;
 try{
  const job=await EBLDesktop.testCompile();let status;
  for(let i=0;i<180;i++){
   status=await EBLDesktop.request('/builds/'+job.id);$('desktopTestResult').textContent=status.status==='building'?'コンパイルしています…\n'+status.log:status.log;
   if(status.status!=='building')break;
   await new Promise(r=>setTimeout(r,1000));
  }
  if(status.status!=='success')throw Error(status.error??'待ち時間を超えました。');
  const buffer=await EBLDesktop.request('/builds/'+job.id+'/binary',{binary:true});
  await verifyBinary(buffer,status);
  $('desktopTestResult').textContent='成功：同梱ツールでARM実行ファイルを生成し、SHA-256を照合しました（'+status.size+' bytes）。\nEV3への転送・実行はしていません。';
 }catch(e){$('desktopTestResult').textContent='失敗：'+e.message;}
 finally{$('desktopTest').disabled=false;}
};
