// モーターの停止方法と左右別速度の有限走行を、標準EV3命令へ展開する。
// 既存作品に設定ブロックがなければ、従来の命令列を維持する。
export const stopModes={brake:1,coast:2,hold:3};
export function motorFeatures(c,enabled,base){
 const {emit,alloc,local:L,globalVar:G,constant:C,expr,guard,nonzero,jump,patch,position}=c;
 const ports=mask=>[0,1,2,3].filter(i=>mask&(1<<i));
 const mode=i=>G(base+4*i);
 const pause=ms=>{const t=L(alloc());emit(0x85,C(ms),t);emit(0x86,t);};
 const nativeBrake=(mask,synchronized=false)=>{
  if(!enabled)return C(1);
  const selected=ports(mask),first=mode(selected[0]);
  // 標準同期命令のBRAKEは2ポート共通。違う設定を黙って変更しない。
  if(synchronized)for(const i of selected.slice(1)){const diff=L(alloc());emit(0x16,first,mode(i),diff);guard(diff,0,0);}
  const flag=L(alloc()),different=L(alloc());emit(0x3a,C(1),flag);emit(0x16,first,C(stopModes.coast),different);
  const low=jump(0x66,[different,C(0)]),high=jump(0x6a,[different,C(0)]);emit(0x3a,C(0),flag);patch(low,position());patch(high,position());return flag;
 };
 const finish=(mask,override)=>{
  if(!enabled)return;
  const release=L(alloc());emit(0x3a,C(0),release);
  for(const i of ports(mask)){
   const m=override===undefined?mode(i):C(stopModes[override]),d=L(alloc());emit(0x16,m,C(stopModes.brake),d);
   const low=jump(0x66,[d,C(0)]),high=jump(0x6a,[d,C(0)]);emit(0x12,release,C(1<<i),release);patch(low,position());patch(high,position());
  }
  const none=jump(0x66,[release,C(1)]);
  // 標準FWのBRAKE=1は能動的な位置保持。短い制動の後に解放することで
  // 「ブレーキ」と「保持」を区別する。正確な停止時間を保証する制御ではない。
  pause(100);emit(0xa3,C(0),release,C(0));patch(none,position());
 };
 const stop=(mask,override)=>{
  if(!enabled){emit(0xa3,C(0),C(mask),C(1));return;}
  for(const i of ports(mask))emit(0xa3,C(0),C(1<<i),override===undefined?nativeBrake(1<<i):C(override==='coast'?0:1));
  finish(mask,override);
 };
 const configure=b=>{for(const i of ports(b.ports))emit(0x3a,C(stopModes[b.mode]),mode(i));};
 const finite=(op,mask,speed,amount)=>{
  if(!enabled){emit(op,C(0),C(mask),speed,C(0),amount,C(0),C(1));return;}
  // 独立制御ではポートごとの停止方法を使う。両方を開始してから待つ。
  for(const i of ports(mask))emit(op,C(0),C(1<<i),speed,C(0),amount,C(0),nativeBrake(1<<i));
 };
 const tank=b=>{
  const a=L(alloc()),d=L(alloc()),speed=L(alloc()),turn=L(alloc());
  emit(0x3a,expr(b.leftSpeed),a);guard(a,-100,100);emit(0x3a,expr(b.rightSpeed),d);guard(d,-100,100);
  const first=b.leftPort<b.rightPort?a:d,second=b.leftPort<b.rightPort?d:a;
  const abs=x=>{const r=L(alloc());emit(0x3a,x,r);const pos=jump(0x6a,[r,C(-1)]);emit(0x16,C(0),r,r);patch(pos,position());return r;};
  const aa=abs(first),dd=abs(second),other=jump(0x66,[aa,dd]);
  emit(0x3a,first,speed);nonzero(speed);emit(0x16,first,second,turn);emit(0x1a,turn,C(100),turn);emit(0x1e,turn,speed,turn);const done=jump(0x40,[]);
  patch(other,position());emit(0x3a,second,speed);nonzero(speed);emit(0x16,first,second,turn);emit(0x1a,turn,C(100),turn);emit(0x1e,turn,speed,turn);patch(done,position());
  guard(turn,-200,200);
  const amount=L(alloc());emit(0x3a,expr(b.action==='angle'?b.degrees:b.secondsAreMs?b.seconds:{scaled:{value:b.seconds,factor:1000,divisor:1}}),amount);guard(amount,1,b.action==='angle'?36000:60000);
  const mask=b.leftPort|b.rightPort,brake=nativeBrake(mask,true);
  emit(0xa2,C(0),C(mask));emit(b.action==='angle'?0xb0:0xb1,C(0),C(mask),speed,turn,amount,brake);emit(0xaa,C(0),C(mask));finish(mask);
 };
 return {nativeBrake,finish,stop,configure,finite,tank};
}
