// 並行実行の構成を検証する。処理ごとにマイブロックのローカル領域を分け、
// 同じ定義を同時に呼んでも引数・待機時計・作業レジスタが混ざらないようにする。
export function parallelPlan(program) {
 const others=program.threads??[];
 if(!Array.isArray(others))throw Error('並行処理の情報が不正です。');
 if(!others.length)return null;
 const roots=[...(program.main.length?[{kind:'start',name:'スタート1',body:program.main}]:[]),...others];
 if(!roots.length||roots.length>16)throw Error('スタート・イベント・メッセージ受信は合計16個までです。');
 const procs=new Map(program.procedures.map(p=>[p.name,p]));
 // 式に差し込んだマイブロックも依存関係に含める（イベント条件・戻り値も対象）。
 const visit=(node,fn,seen=new Set())=>{
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const n of node)visit(n,fn,seen);return;}
  fn(node);
  for(const value of Object.values(node))visit(value,fn,seen);
  const call=node.callValue??(['call','callOutputs'].includes(node.type)?node:null);
  if(call){if(node.callValue||node.type==='callOutputs')fn({...call,type:'call'});if(!seen.has(call.name)){seen.add(call.name);const p=procs.get(call.name);visit(p?.body,fn,seen);visit(p?.results??p?.result,fn,seen);}}
 };
 const messages=new Map(),waits=roots.map(()=>new Set()),modes=new Map();
 const message=name=>{if(typeof name!=='string'||!name.trim()||name.length>40||name.includes('\0'))throw Error('メッセージ名は1〜40文字にしてください。');if(!messages.has(name))messages.set(name,messages.size);};
 roots.forEach((r,i)=>{
  if(!['start','condition','changed','message'].includes(r.kind)||!Array.isArray(r.body))throw Error('イベントの種類を確認してください。');
  if(['condition','changed'].includes(r.kind)&&r.condition===undefined)throw Error('イベントの条件・値を入れてください。');
  if(r.kind==='message')message(r.message);
  const inspect=x=>{if(!x||typeof x!=='object')return;const sensor=x.sensor??(x.type==='gyroReset'?{kind:'gyroAngle',port:x.port}:null);if(sensor&&!['encoder','motorSpeed'].includes(sensor.kind)){
    const s=sensor,mode=['gyroAngle','gyroRate'].includes(s.kind)?'gyroCombined':['color','reflected'].includes(s.kind)?s.kind:['irRemote','irBeaconDistance','irBeaconHeading','irBeaconDetected','infrared'].includes(s.kind)?(s.kind==='irRemote'?'remote':s.kind==='infrared'?'proximity':'beacon'):s.kind;
    const previous=modes.get(s.port)??[];
    if(previous.some(p=>p.root!==i&&p.mode!==mode))throw Error(`センサ${s.port}を並行処理で異なるモードにはできません。同じモードにそろえてください。`);
    previous.push({root:i,mode});modes.set(s.port,previous);
   }for(const v of Object.values(x))inspect(v);};
  inspect(r.condition);visit([r.condition,r.body],b=>{inspect(b);if(b.type==='broadcast'){message(b.message);if(b.wait)waits[i].add(b.message);}});
 });
 if(messages.size>32)throw Error('メッセージは32種類までです。');
 // 自分を待つ・相互に待つ構成は永久待機になるため、転送前に知らせる。
 const graph=waits.map(names=>roots.flatMap((r,i)=>r.kind==='message'&&names.has(r.message)?[i]:[]));
 const done=new Set(),active=new Set();
 const dfs=i=>{if(active.has(i))throw Error('「送って待つ」が自分自身または互いの処理を待っています。「送る」に変更するか処理を分けてください。');if(done.has(i))return;active.add(i);for(const j of graph[i])dfs(j);active.delete(i);done.add(i);};
 roots.forEach((_,i)=>dfs(i));
 return {roots,messages,visit};
}

// Lamportのベーカリー法。VMが命令の途中で処理を切り替えても、共有リスト・
// 文字列・CSVへの変更を1処理ずつ実行する。モーターの動作完了はロックしない。
export function sharedLock(c,root,count,base) {
 const {emit,alloc,local:L,globalVar:G,constant:C,jump,patch,position,guard}=c;
 const choosing=i=>G(base+i*8),ticket=i=>G(base+i*8+4);
 const delay=()=>{const t=L(alloc());emit(0x85,C(1),t);emit(0x86,t);};
 const back=at=>{const j=jump(0x40,[]);patch(j,at);};
 return {
  acquire(){
   emit(0x3a,C(1),choosing(root));const n=L(alloc());emit(0x3a,C(0),n);
   for(let i=0;i<count;i++){const skip=jump(0x6a,[n,ticket(i)]);emit(0x3a,ticket(i),n);patch(skip,position());}
   guard(n,0,2147483645);emit(0x12,n,C(1),ticket(root));emit(0x3a,C(0),choosing(root));
   for(let i=0;i<count;i++)if(i!==root){
    const choose=position(),ready=jump(0x66,[choosing(i),C(1)]);delay();back(choose);patch(ready,position());
    const check=position(),free=jump(0x66,[ticket(i),C(1)]),later=jump(0x6a,[ticket(i),ticket(root)]);
    let same;if(i>root){const d=L(alloc());emit(0x16,ticket(i),ticket(root),d);same=jump(0x66,[d,C(1)]);}
    delay();back(check);for(const p of [free,later,same])if(p!==undefined)patch(p,position());
   }
  },
  release(){emit(0x3a,C(0),ticket(root));}
 };
}
