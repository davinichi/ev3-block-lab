// EV3内で行う文字列・数値リスト・CSV記録。ブラウザが接続していなくても動作する。
// 文字列はUTF-8で120バイト、数値リストは1000項目まで。上限超過は共通エラー処理へ進む。
export const TEXT_BYTES=120,LIST_ITEMS=1000;
export const isText=x=>typeof x?.text==='string'||x?.textVar!==undefined||x?.textOp!==undefined;
const name=n=>{if(typeof n!=='string'||!n.trim()||n.length>40||n.includes('\0'))throw Error('文字列・リストの名前は1〜40文字にしてください。');};
export function checkText(x){
 if(typeof x?.text==='string'){if(x.text.includes('\0')||new TextEncoder().encode(x.text).length>TEXT_BYTES)throw Error('文字列はUTF-8で120バイト以内（日本語は通常40文字以内）にしてください。');return;}
 if(x?.textVar!==undefined){name(x.textVar);return;}
 if(!['join','letter','number'].includes(x?.textOp))throw Error('文字列の入力を確認してください。');
 if(x.textOp==='join'){checkText(x.a);checkText(x.b);}else if(x.textOp==='letter')checkText(x.value);
}
export function extraLayout(program,base,directory){
 const texts=new Map(),lists=new Map(),files=new Set();let logs=false;
 const visit=x=>{if(!x||typeof x!=='object')return;
  if(x.textVar!==undefined){name(x.textVar);texts.set(x.textVar,0);}if(x.type==='textSet'){name(x.name);texts.set(x.name,0);}
  if(x.list!==undefined){name(x.list);lists.set(x.list,0);}if(['logStart','logValue','logEnd'].includes(x.type))logs=true;
  if(x.type==='logStart'){if(!/^[A-Za-z0-9_-]{1,31}$/.test(x.file??''))throw Error('ログ名は半角英数字・-・_で1〜31文字にしてください。');files.add(x.file);}
  if(typeof x.text==='string')checkText(x);for(const v of Object.values(x))visit(v);
 };visit(program);
 if(texts.size>16||lists.size>16)throw Error('文字列変数とリストは、それぞれ16個までです。');
 let at=base;for(const k of texts.keys()){texts.set(k,at);at+=124;}for(const k of lists.keys()){lists.set(k,at);at+=4;}
 const logAt=at;if(logs)at+=140; // 有効フラグ、開始時計、行数、ファイル名バッファ
 return {texts,lists,logs,logAt,bytes:at-base,files:[...files],directory};
}
// コンパイラのオペランド・ジャンプ・式生成を受け取り、同じオブジェクトへ命令を追加する。
export function dataEmitter(c,layout){
 const {emit,alloc,local:L,globalVar:G,constant:C,zstr,floatExpr:F,expr:I,asFloat,guard,floatGuard,jump,patch,faults}=c;
 const reg=()=>L(alloc()),buf=()=>{const at=alloc();for(let i=0;i<30;i++)alloc();return L(at);};
 const S=s=>[0x84,...zstr(s)];
 const move=(n,r)=>emit(0x3a,C(n),r),inc=r=>emit(0x12,r,C(1),r);
 const read=(s,i,r)=>{move(0,r);emit(0xc8,s,i,r);emit(0x26,r,C(255),r);};
 const back=start=>{const j=jump(0x40,[]);patch(j,start);};
 const zero=s=>emit(0xcc,C(0),C(0),s);
 // byte長と文字数は別々。UTF-8の継続バイトを数えず、日本語も1文字として扱う。
 const length=(s,chars=false)=>{const i=reg(),count=reg(),b=reg();move(0,i);move(0,count);const top=c.position();read(s,i,b);const end=jump(0x66,[b,C(1)]);if(chars){const isAscii=jump(0x66,[b,C(128)]),continuation=jump(0x66,[b,C(192)]);patch(isAscii,c.position());inc(count);patch(continuation,c.position());}else inc(count);inc(i);guard(i,0,TEXT_BYTES);back(top);patch(end,c.position());return count;};
 const copy=(source,target,offset=null)=>{const i=reg(),out=offset??reg(),b=reg();move(0,i);if(!offset)move(0,out);const top=c.position();read(source,i,b);const end=jump(0x66,[b,C(1)]);guard(out,0,TEXT_BYTES-1);emit(0xcc,b,out,target);inc(i);inc(out);back(top);patch(end,c.position());emit(0xcc,C(0),out,target);return out;};
 const text=x=>{
  checkText(x);if(x.text!==undefined)return S(x.text);if(x.textVar!==undefined)return G(layout.texts.get(x.textVar));
  const out=buf();zero(out);
  if(x.textOp==='join'){const a=text(x.a),b=text(x.b),at=copy(a,out);copy(b,out,at);return out;}
  if(x.textOp==='number'){const n=F(x.value);floatGuard(n);emit(0x7d,C(11),n,S('%.7g'),C(120),out);return out;}
  const source=text(x.value),nth=I(x.index),size=length(source,true);guard(nth,1,TEXT_BYTES);
  const missing=jump(0x6a,[nth,size]),i=reg(),count=reg(),b=reg();move(0,i);move(0,count);
  const seek=c.position();read(source,i,b);const skip=jump(0x66,[b,C(128)]),cont=jump(0x66,[b,C(192)]);patch(skip,c.position());inc(count);const found=jump(0x6a,[count,nth]);const match=reg();emit(0x16,count,nth,match);emit(0x1a,match,match,match);const begin=jump(0x66,[match,C(1)]);patch(cont,c.position());inc(i);back(seek);
  patch(begin,c.position());const j=reg();move(0,j);const take=c.position();read(source,i,b);emit(0xcc,b,j,out);inc(i);inc(j);read(source,i,b);const done=jump(0x66,[b,C(1)]),nextAscii=jump(0x66,[b,C(128)]),nextHead=jump(0x6a,[b,C(191)]);back(take);for(const p of [done,nextAscii,nextHead,found])patch(p,c.position());emit(0xcc,C(0),j,out);patch(missing,c.position());return out;
 };
 const listHandle=n=>G(layout.lists.get(n));
 const size=n=>{const r=reg();emit(0xc1,C(12),listHandle(n),r);return r;};
 const index=(x,n)=>{const at=I(x),last=size(n);guard(at,1,LIST_ITEMS);faults.push(jump(0x6a,[at,last]));const r=reg();emit(0x16,at,C(1),r);return r;};
 const numeric=x=>{
  if(x?.textData){const {op,value,other}=x.textData,source=text(value);if(op==='length')return asFloat(length(source,true));
   if(op==='number'){
   // 標準VMの変換は入力を変更し、変換失敗時の値も保証しない。コピーを作り、文法を先に検査する。
   const safe=buf();copy(source,safe);const i=reg(),b=reg(),digits=reg();move(0,i);move(0,digits);
   const optionalSign=()=>{read(safe,i,b);const plusLow=jump(0x66,[b,C(43)]),plusHigh=jump(0x6a,[b,C(43)]);inc(i);const plusDone=jump(0x40,[]);patch(plusLow,c.position());patch(plusHigh,c.position());read(safe,i,b);const minusLow=jump(0x66,[b,C(45)]),minusHigh=jump(0x6a,[b,C(45)]);inc(i);patch(minusLow,c.position());patch(minusHigh,c.position());patch(plusDone,c.position());};
   const scanDigits=()=>{const top=c.position();read(safe,i,b);const low=jump(0x66,[b,C(48)]),high=jump(0x6a,[b,C(57)]);inc(i);inc(digits);back(top);patch(low,c.position());patch(high,c.position());};
   optionalSign();scanDigits();read(safe,i,b);const dotLow=jump(0x66,[b,C(46)]),dotHigh=jump(0x6a,[b,C(46)]);inc(i);scanDigits();patch(dotLow,c.position());patch(dotHigh,c.position());guard(digits,1,TEXT_BYTES);
   read(safe,i,b);const lower=reg();emit(0x22,b,C(32),lower);const expLow=jump(0x66,[lower,C(101)]),expHigh=jump(0x6a,[lower,C(101)]);inc(i);optionalSign();move(0,digits);scanDigits();guard(digits,1,TEXT_BYTES);patch(expLow,c.position());patch(expHigh,c.position());read(safe,i,b);guard(b,0,0);
   const r=reg();emit(0x7d,C(7),safe,r);floatGuard(r);return r;
  }
   const needle=text(other),n=length(source),m=length(needle),result=reg(),i=reg(),j=reg(),a=reg(),b=reg(),at=reg();move(0,result);move(0,i);
   if(op==='equal'){const different=reg();emit(0x16,n,m,different);const skip=jump(0x6a,[different,C(0)]),skip2=jump(0x66,[different,C(0)]);const start=c.position();move(0,j);const inner=c.position();const done=jump(0x6a,[j,m]);read(source,j,a);read(needle,j,b);const diff=reg();emit(0x16,a,b,diff);const mismatch1=jump(0x6a,[diff,C(0)]),mismatch2=jump(0x66,[diff,C(0)]);inc(j);const finished=jump(0x6a,[j,m]);back(inner);for(const p of [done,finished])patch(p,c.position());move(1,result);for(const p of [skip,skip2,mismatch1,mismatch2])patch(p,c.position());return asFloat(result);}
   // 部分文字列検索はUTF-8のバイト列で比較する。空の検索文字列は含まれる。
   const outer=c.position();emit(0x12,i,m,at);const noRoom=jump(0x6a,[at,n]);move(0,j);const inner=c.position();const matched=jump(0x66,[m,C(1)]),all=reg();emit(0x16,m,j,all);const matched2=jump(0x66,[all,C(1)]);emit(0x12,i,j,at);read(source,at,a);read(needle,j,b);const d=reg();emit(0x16,a,b,d);const mismatch1=jump(0x6a,[d,C(0)]),mismatch2=jump(0x66,[d,C(0)]);inc(j);back(inner);for(const p of [mismatch1,mismatch2])patch(p,c.position());inc(i);back(outer);for(const p of [matched,matched2])patch(p,c.position());move(1,result);patch(noRoom,c.position());return asFloat(result);
  }
  if(!x?.listData)return null;
  const {op,list}=x.listData,h=listHandle(list),n=size(list),r=reg();
  if(op==='length')return asFloat(n);
  if(op==='item'){emit(0xc3,h,index(x.listData.index,list),r);floatGuard(r);return r;}
  const i=reg(),v=reg();move(0,i);emit(0x3f,c.floatConstant(0),r);const search=op==='contains'?F(x.listData.value):null;
  if(['min','max','average'].includes(op))guard(n,1,LIST_ITEMS);
  const top=c.position(),end=jump(0x66,[n,C(1)]),done=reg();emit(0x16,n,i,done);const end2=jump(0x66,[done,C(1)]);emit(0xc3,h,i,v);floatGuard(v);
  if(op==='contains'){const no=jump(0x6b,[v,search]),no2=jump(0x67,[v,search]);emit(0x3f,c.floatConstant(1),r);const found=jump(0x40,[]);patch(no,c.position());patch(no2,c.position());inc(i);back(top);patch(found,c.position());}
  else if(['min','max'].includes(op)){const first=jump(0x66,[i,C(1)]),skip=jump(op==='min'?0x6b:0x67,[v,r]);patch(first,c.position());emit(0x3f,v,r);patch(skip,c.position());inc(i);back(top);}
  else{emit(0x13,r,v,r);floatGuard(r);inc(i);back(top);}
  patch(end,c.position());patch(end2,c.position());if(op==='average')emit(0x1f,r,asFloat(n),r);floatGuard(r);return r;
 };
 const open=(sub,path)=>{const h=reg();move(-1,h);emit(0xc0,C(sub),path,h); // FILEはDATA16。符号付き16→32へ拡張して失敗を検出。
  const signed=reg();emit(0x36,h,signed);guard(signed,0,32767);return h;};
 const close=h=>emit(0xc0,C(7),h),write=(h,s)=>emit(0xc0,C(6),h,C(0),s);
 const quoted=(h,s,protect=true)=>{write(h,S('"'));if(protect){const first=reg();read(s,C(0),first);for(const code of [61,43,45,64]){const a=jump(0x66,[first,C(code)]),b=jump(0x6a,[first,C(code)]);write(h,S("'"));patch(a,c.position());patch(b,c.position());}}
  const i=reg(),b=reg(),one=buf();move(0,i);const top=c.position();read(s,i,b);const end=jump(0x66,[b,C(1)]);emit(0xcc,b,C(0),one);emit(0xcc,C(0),C(1),one);write(h,one);const a=jump(0x66,[b,C(34)]),d=jump(0x6a,[b,C(34)]);write(h,S('"'));patch(a,c.position());patch(d,c.position());inc(i);back(top);patch(end,c.position());write(h,S('"'));
 };
 const logFlag=G(layout.logAt),logClock=G(layout.logAt+4),logCount=G(layout.logAt+8),logPath=G(layout.logAt+12);
 const statement=b=>{
  if(b.type==='textSet'){copy(text(b.value),G(layout.texts.get(b.name)));return true;}
  if(b.type==='listClear'){emit(0xc1,C(5),listHandle(b.list),C(0));return true;}
  if(b.type==='listAdd'){const n=size(b.list);guard(n,0,LIST_ITEMS-1);const v=F(b.value);floatGuard(v);emit(0xc4,listHandle(b.list),v);return true;}
  if(b.type==='listSet'){const at=index(b.index,b.list),v=F(b.value);floatGuard(v);emit(0xc2,listHandle(b.list),at,v);return true;}
  if(b.type==='listDelete'){const at=index(b.index,b.list),n=size(b.list),i=reg(),next=reg(),v=reg();emit(0x3a,at,i);const top=c.position();emit(0x12,i,C(1),next);const diff=reg();emit(0x16,n,next,diff);const end=jump(0x66,[diff,C(1)]);emit(0xc3,listHandle(b.list),next,v);emit(0xc2,listHandle(b.list),i,v);inc(i);back(top);patch(end,c.position());emit(0x16,n,C(1),n);emit(0xc1,C(5),listHandle(b.list),n);return true;}
  if(b.type==='logStart'){const path=S(layout.directory+'/'+b.file+'.csv');const h=open(2,path);write(h,S('time_s,item,value\r\n'));close(h);emit(0x7d,C(5),path,logPath);emit(0x87,logClock);move(0,logCount);move(1,logFlag);return true;}
  if(b.type==='logEnd'){move(0,logFlag);return true;}
  if(b.type==='logValue'){
   guard(logFlag,1,1);guard(logCount,0,4999);const value=isText(b.value)?text(b.value):text({textOp:'number',value:b.value});checkText({text:b.label});
   const now=reg(),seconds=reg(),stamp=buf();emit(0x87,now);emit(0x16,now,logClock,now);emit(0x1f,asFloat(now),c.floatConstant(1000),seconds);emit(0x7d,C(11),seconds,S('%.3f'),C(120),stamp);
   const h=open(0,logPath);write(h,stamp);write(h,S(','));quoted(h,S(b.label));write(h,S(','));quoted(h,value,isText(b.value));write(h,S('\r\n'));close(h);inc(logCount);return true;
  }
  return false;
 };
 const init=()=>{for(const at of layout.texts.values())zero(G(at));for(const at of layout.lists.values()){emit(0xc1,C(4),C(0),G(at));const signed=reg();emit(0x36,G(at),signed);guard(signed,0,32767);}if(layout.logs){move(0,logFlag);move(0,logCount);}};
 return {numeric,statement,init,text};
}
