// PIDの状態はEV3の共有メモリに置く。ブラウザとの接続は不要。
// 同じ名前は同じ制御器、異なる名前は独立。呼出し元のロックで更新を直列化する。
export function pidName(name){
 if(typeof name!=='string'||!name.trim()||name.length>40||name.includes('\0'))throw Error('PIDの名前は1〜40文字にしてください。');
 return name;
}
export function validatePid(pid,read){
 pidName(pid.name);
 for(const key of ['target','measured','kp','ki','kd'])read(pid[key]);
}
export function pidLayout(program,base){
 const controllers=new Map();
 const visit=x=>{
  if(!x||typeof x!=='object')return;
  if(x.pid||x.type==='pidReset'){const name=pidName(x.pid?.name??x.name);if(!controllers.has(name))controllers.set(name,base+controllers.size*20);}
  for(const value of Object.values(x))visit(value);
 };visit(program);
 if(controllers.size>16)throw Error('PID制御器は16種類までです。');
 return {controllers,bytes:controllers.size*20};
}
// [初期化済みDATA32, 前回偏差DATAF, 偏差積分DATAF, 前回時刻DATA32, 出力DATAF]
export function pidEmitter(c,layout){
 const {emit,alloc,local:L,globalVar:G,constant:C,floatConstant:F,floatExpr,asFloat,floatGuard,jump,patch,position}=c;
 const at=name=>{const base=layout.controllers.get(pidName(name));if(base===undefined)throw Error('PIDの名前を確認してください。');return Array.from({length:5},(_,i)=>G(base+i*4));};
 const reset=name=>{for(const target of at(name))emit(0x3a,C(0),target);};
 return {
  init(){for(const name of layout.controllers.keys())reset(name);},reset,
  compute(p){
   const [initialized,previous,integral,lastTime,cached]=at(p.name),reg=()=>L(alloc());
   // 入力は各1回評価し、その時点の値を保存する。センサや引数も使用できる。
   const values={};for(const key of ['target','measured','kp','ki','kd']){const value=reg();emit(0x3f,floatExpr(p[key]),value);floatGuard(value);values[key]=value;}
   const error=reg(),now=reg(),elapsed=reg(),result=reg();
   emit(0x17,values.target,values.measured,error);floatGuard(error);emit(0x87,now);
   const first=jump(0x66,[initialized,C(1)]);
   emit(0x16,now,lastTime,elapsed);
   // 同じミリ秒に再評価しても積分を二重加算せず、ゼロ除算もしない。
   const unchanged=jump(0x66,[elapsed,C(1)]),stale=jump(0x6a,[elapsed,C(60000)]);
   const dt=reg(),area=reg(),derivative=reg(),proportional=reg(),iTerm=reg(),dTerm=reg();
   emit(0x1f,asFloat(elapsed),F(1000),dt);
   emit(0x1b,error,dt,area);emit(0x13,integral,area,integral);floatGuard(integral);
   emit(0x17,error,previous,derivative);emit(0x1f,derivative,dt,derivative);
   emit(0x1b,values.kp,error,proportional);emit(0x1b,values.ki,integral,iTerm);emit(0x1b,values.kd,derivative,dTerm);
   floatGuard(proportional);floatGuard(iTerm);floatGuard(dTerm);
   emit(0x13,proportional,iTerm,result);emit(0x13,result,dTerm,result);floatGuard(result);
   const computed=jump(0x40,[]);
   // 最初の1回と60秒超の中断後はP項のみ。古い積分や大きな微分を持ち越さない。
   patch(first,position());patch(stale,position());emit(0x3a,C(0),integral);emit(0x1b,values.kp,error,result);floatGuard(result);
   patch(computed,position());emit(0x3f,error,previous);emit(0x3a,now,lastTime);emit(0x3a,C(1),initialized);emit(0x3f,result,cached);
   const finished=jump(0x40,[]);patch(unchanged,position());emit(0x3f,cached,result);patch(finished,position());
   return result;
  }
 };
}
