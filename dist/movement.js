// 動き専用の配線は実行時の共有状態。モーター単独命令の配線とは分離する。
export const movementError='動きに使うモーターを設定してください。設定ブロックを動きより前につなぎ、左右の配線を再確認してください。';
export const movementId=(left,right)=>left*16+right;
export function movementPlan(program){
 const procedures=new Map(program.procedures.map(p=>[p.name,p]));
 const pairs=new Map();let hasMovement=false,visits=0;
 const scan=(nodes,stack=[])=>{for(const b of nodes){
  if(++visits>20000)throw Error('動きの設定を確認する処理が多すぎます。');
  if(b.type==='repeat'&&b.count===0)continue;
  if(b.type==='movementSetup'){
   if(![1,2,4,8].includes(b.leftPort)||![1,2,4,8].includes(b.rightPort)||b.leftPort===b.rightPort)throw Error('動きの左右には異なるモーターポートを選んでください。');
   pairs.set(movementId(b.leftPort,b.rightPort),{leftPort:b.leftPort,rightPort:b.rightPort});
  }
  if(b.movement)hasMovement=true;
  if(b.type==='call'&&!stack.includes(b.name))scan(procedures.get(b.name)?.body??[],[...stack,b.name]);
  for(const key of ['body','then','else'])if(b[key])scan(b[key],stack);
  if(['programEnd','myblockReturn'].includes(b.type))break;
 }};
 const roots=[program.main,...(program.threads??[]).map(t=>t.body)];roots.forEach(r=>scan(r));
 if(hasMovement&&!pairs.size)throw Error(movementError);
 // すべての到達経路を調べる。終了経路は後続へ合流させず、定義からの早期復帰は合流する。
 // 並行処理では他の処理の設定を順序保証とは扱わず、本体側のチェックへ委ねる。
 const parallel=!!program.threads?.length;
 visits=0;
 function flow(nodes,states,stack=[]){
  let active=states,returned=[],ended=[];
  for(const b of nodes){
   if(++visits>20000)throw Error('動きの実行順を確認する処理が多すぎます。');
   if(!active.length)break;
   if(b.movement&&!parallel&&active.includes(false))throw Error(movementError);
   if(b.type==='movementSetup')active=[true];
   else if(b.type==='myblockReturn'){returned.push(...active);active=[];}
   else if(b.type==='programEnd'){ended.push(...active);active=[];}
   else if(b.type==='call'){
    if(stack.includes(b.name))throw Error('マイブロックの再帰呼び出しは使えません。');
    const result=flow(procedures.get(b.name)?.body??[],active,[...stack,b.name]);
    active=[...new Set([...result.active,...result.returned])];ended.push(...result.ended);
   }else if(b.type==='if'){
    const yes=flow(b.then,active,stack),no=flow(b.else,active,stack);
    active=[...new Set([...yes.active,...no.active])];returned.push(...yes.returned,...no.returned);ended.push(...yes.ended,...no.ended);
   }else if(['repeat','while','forever'].includes(b.type)){
    if(b.type==='repeat'&&b.count===0)continue;
    const result=flow(b.body,active,stack);returned.push(...result.returned);ended.push(...result.ended);
    active=b.type==='forever'?[]:b.type==='repeat'&&typeof b.count==='number'&&b.count>=1?result.active:[...new Set([...active,...result.active])];
   }
  }
  return {active,returned,ended};
 }
 roots.forEach(r=>flow(r,[false]));
 return pairs;
}
