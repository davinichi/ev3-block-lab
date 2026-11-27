export const TARGET_STORAGE='ev3-block-lab-target-v1';
export function installTargetMode({document,storage,isBusy=()=>false,isStandardConnected=()=>false,onChange=()=>{},onError=()=>{},version='',desktop=false}){
 const $=id=>document.getElementById(id),picker=$('programTarget');
 let current='ev3rt';
 const valid=target=>target==='ev3rt'||target==='standard';
 function render(target){
  const rt=target==='ev3rt';
  document.body.dataset.target=target;picker.value=target;
  $('standardEv3Tools').hidden=rt;$('standardEv3Tools').inert=rt;
  $('ev3rtDialog').hidden=!rt;
  $('targetDescription').textContent=rt?'EV3RT/HRP3のSDカードで起動した本体へ転送します。':'標準LEGOファームウェアで起動した本体へ.rbfを転送します。';
  $('appBrandName').textContent=rt?'Block Lab RT':'Block Lab';
  $('panelTargetTitle').textContent=rt?'EBL-RTのコンパイル・転送':'EBLの接続・転送';
  const toggle=$('toggleConnectionPanel');(toggle.querySelector?.('span')??toggle).textContent=rt?'コンパイル・転送':'接続・転送';
  document.title=rt?'EV3 Block Lab RT（EBL-RT）':'EV3 Block Lab（EBL）';
  const badge=document.querySelector('.badge');if(badge)badge.textContent=`${desktop?'Windows · ':''}${rt?'EBL-RT':'EBL'} · ${version}`;
  for(const e of document.querySelectorAll('[data-target-only]'))e.hidden=e.dataset.targetOnly!==target;
 }
 function select(target,{initial=false}={}){
  if(!valid(target))throw Error('転送対象を選んでください。');
  if(!initial&&target===current){picker.value=current;return current;}
  if(!initial&&isBusy())throw Error('コンパイル・転送・通信が終わってから切り替えてください。');
  if(!initial&&isStandardConnected())throw Error('標準EV3との接続を「切断」してから切り替えてください。実行中のプログラムは本体で停止してください。');
  const previous=current;
  render(target);current=target;
  try{onChange(target,previous,{initial});}
  catch(error){current=previous;render(previous);throw error;}
  try{storage?.setItem(TARGET_STORAGE,target);}catch{}
  return current;
 }
 let saved;try{saved=storage?.getItem(TARGET_STORAGE);}catch{}
 select(valid(saved)?saved:'ev3rt',{initial:true});
 picker.onchange=()=>{try{select(picker.value);}catch(error){picker.value=current;onError(error.message);}};
 return {select,get target(){return current;}};
}
