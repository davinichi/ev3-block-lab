import {movementPlan,movementId} from './movement.js';
import {pidName,validatePid,pidLayout,pidEmitter} from './pid.js';
import {validateDisplay,emitDisplay,presetBitmap} from './display.js';
import {motorFeatures,stopModes} from './motor-features.js';
import {parallelPlan,sharedLock} from './parallel.js';
import {extraLayout,dataEmitter,isText,checkText} from './data.js';
// EV3 bytecode and system-command implementation. No firmware image is modified.
// EV3標準ファームウェア用のバイトコード生成と通信を担当する。ファームウェア自体は書き換えない。
// 上半分は中間データからRBFを作るコンパイラ、下半分はBluetooth/USBの接続とファイル転送。
export const u16 = n => [n & 255, (n >>> 8) & 255];
export const u32 = n => [...u16(n), ...u16(n >>> 16)];
export const zstr = s => [...new TextEncoder().encode(s), 0];
// 本体のファイル名を制限し、区切り文字や親フォルダ指定が保存先に入り込まないようにする。
export function programFileName(name) {
  if(typeof name!=='string' || !/^[A-Za-z0-9_-]{1,31}$/.test(name))throw Error('EV3に保存する名前は、半角英数字・「-」「_」で1〜31文字にしてください。');
  return `${name}.rbf`;
}
export function projectDirectory(name='EV3Lab') {
  if(typeof name!=='string' || !/^[A-Za-z0-9_-]{1,31}$/.test(name))throw Error('EV3のプロジェクト名は、半角英数字・「-」「_」で1〜31文字にしてください。');
  return `../prjs/${name}`;
}
// EV3命令の整数オペランドを可変長で符号化する。ここはユーザー向け小数計算とは別の層。
export function constant(n) {
  if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) throw Error('整数の範囲を超えています。');
  if (n >= -32 && n <= 31) return [n & 63];
  if (n >= -128 && n <= 127) return [0x81, n & 255];
  if (n >= -32768 && n <= 32767) return [0x82, ...u16(n)];
  return [0x83, ...u32(n)];
}
// 変数の値そのものではなく、VMのローカル／グローバルメモリのアドレスを符号化する。
export const local = n => n < 32 ? [0x40 | n] : n < 128 ? [0xc1, n] : n < 32768 ? [0xc2, ...u16(n)] : [0xc3,...u32(n)];
export const globalVar = n => n < 32 ? [0x60 | n] : n < 128 ? [0xe1,n] : [0xe2,...u16(n)];
export const OP = {END:0x0a, RETURN:0x08, CALL:0x09, PROGRAM_STOP:0x02, OBJECT_START:0x05, OBJECT_WAIT:0x07, JR:0x40, JR_LT32:0x66, JR_GT32:0x6a, MOVE32:0x3a, ADD32:0x12, SUB32:0x16, MUL32:0x1a, DIV32:0x1e,
  INPUT_DEVICE:0x99, MOVEF32:0x3e, TIMER_READ:0x87, MOTOR_COUNT:0xb3, MOTOR_SPEED:0xa5, MOTOR_POWER:0xa4, MOTOR_READ:0xa8, MOTOR_START:0xa6, MOTOR_TEST:0xa9,
  WAIT:0x85, READY:0x86, SOUND:0x94, SOUND_READY:0x96, MOTOR_RESET:0xa2, MOTOR_CLEAR_COUNT:0xb2, STOP:0xa3, MOTOR:0xae, MOTOR_TIME:0xaf, MOTOR_SYNC:0xb0, MOTOR_READY:0xaa};
// センサ・ボタンなど実行前に確定しない値を示す。0と区別して、未実行の測定値を決め打ちしない。
const UNKNOWN=Symbol('runtime sensor value');
const inRange = (v,a,b,label) => {if(v===UNKNOWN)return;if (!Number.isInteger(v) || v<a || v>b) throw Error(`${label}は ${a}〜${b} の整数にしてください。`);};
const FLOATS=Symbol('floating-point expressions'),MAX_FLOAT=3.4028234663852886e38;
const unaryCodes={abs:6,floor:3,ceil:4,sqrt:8,sin:11,cos:12,tan:13,asin:14,acos:15,atan:16,ln:10,log:9,exp:1,pow10:20};
// All user numbers, variables and parameters use native EV3 DATAF consistently.
function finiteNumber(n,label='計算結果'){if(n!==UNKNOWN&&(!Number.isFinite(n)||Math.abs(n)>MAX_FLOAT))throw Error(label+'が計算できる範囲を超えています。');return n;}
function unaryValue(fn,n){
 if(!Object.hasOwn(unaryCodes,fn))throw Error('未対応の数値関数です。');if(n===UNKNOWN)return UNKNOWN;
 if(fn==='sqrt'&&n<0)throw Error('平方根には0以上の数を入れてください。');
 if(['ln','log'].includes(fn)&&n<=0)throw Error('対数には0より大きい数を入れてください。');
 if(['asin','acos'].includes(fn)&&(n< -1||n>1))throw Error('asin・acosには−1〜1の数を入れてください。');
 if(fn==='tan'&&Math.abs(n%180)===90)throw Error('この角度のtanは計算できません。');
 const rad=n*Math.PI/180;
 return finiteNumber(Math.fround(({abs:Math.abs,floor:Math.floor,ceil:Math.ceil,sqrt:Math.sqrt,sin:()=>Math.sin(rad),cos:()=>Math.cos(rad),tan:()=>Math.tan(rad),asin:x=>Math.asin(x)*180/Math.PI,acos:x=>Math.acos(x)*180/Math.PI,atan:x=>Math.atan(x)*180/Math.PI,ln:Math.log,log:Math.log10,exp:Math.exp,pow10:x=>10**x})[fn](n)));
}
// EV3のDATAFは32ビット浮動小数点。検証側もMath.froundを使い、本体と同じ丸めを再現する。
function floatingConstant(n){const bytes=new Uint8Array(4);new DataView(bytes.buffer).setFloat32(0,finiteNumber(Math.fround(n)),true);return [0x83,...bytes];}
const procedureResults=p=>p.returns?(p.results??[p.result]):[];
const PARALLEL=Symbol('parallel');
const GLOBALS=Symbol('globals'),GEOMETRY=Symbol('geometry'),RETURNS=Symbol('return states'),CALL_VALUE=Symbol('numeric call'),VALUE_RETURN=Symbol('numeric return');
const arithmetic={add:(a,b)=>a+b,sub:(a,b)=>a-b,mul:(a,b)=>a*b,div:(a,b)=>{if(b===0)throw Error('0では割れません。');return Math.trunc(a/b);},eq:(a,b)=>+(a===b),neq:(a,b)=>+(a!==b),lt:(a,b)=>+(a<b),lte:(a,b)=>+(a<=b),gt:(a,b)=>+(a>b),gte:(a,b)=>+(a>=b),and:(a,b)=>+(!!a&&!!b),or:(a,b)=>+(!!a||!!b)};
// ボタン番号はEV3固有の並び。いずれか=7は上下左右と中央をまとめ、戻るボタンは停止操作用に残す。
function buttonConfiguration(button){
  if(!button || ![1,2,3,4,5,7].includes(button.id))throw Error('本体ボタンを選んでください。');
  return button.id===7?[1,2,3,4,5]:[button.id];
}
// 種類ごとのEV3デバイス番号・モード・範囲・データ数をまとめる。赤外線は1回の読み取りに複数CHが含まれる。
function sensorConfiguration(sensor){
 const {kind,port,channel}=sensor;
 if(!Number.isInteger(port)||port<1||port>4)throw Error('センサの種類・ポートを確認してください。');
 const configs={color:{type:29,mode:2,min:0,max:7},reflected:{type:29,mode:0,min:0,max:100},distance:{type:30,mode:0,min:0,max:255},touch:{type:16,mode:0,min:0,max:1},infrared:{type:33,mode:0,min:0,max:100},irRemote:{type:33,mode:2,min:0,max:11,count:4},irBeaconDistance:{type:33,mode:1,min:0,max:100,count:8},irBeaconHeading:{type:33,mode:1,min:-25,max:25,count:8},irBeaconDetected:{type:33,mode:1,min:0,max:1,count:8},gyroAngle:{type:32,mode:3,min:-32767,max:32767,count:2,index:0},gyroRate:{type:32,mode:3,min:-440,max:440,count:2,index:1},encoder:{encoder:true},motorSpeed:{motor:true}};
 if(!Object.hasOwn(configs,kind))throw Error('センサの種類・ポートを確認してください。');
 const config=configs[kind];
 if(kind.startsWith('ir')&&config.count&&(!Number.isInteger(channel)||channel<1||channel>4))throw Error('赤外線センサのチャンネルは1〜4から選んでください。');
 return config;
}
// 転送前の検証用に式を評価する。確定する値は計算し、実測が必要な値はUNKNOWNとして後段の検査へ渡す。
function evaluate(x, env) {
  if (typeof x==='number') {if(!Number.isFinite(x))throw Error('数値を確認してください。');return env[FLOATS]?finiteNumber(Math.fround(x)):x;}
  if(x?.callValue)return env[CALL_VALUE](x.callValue);
  if(x?.battery!==undefined){if(!['voltage','current'].includes(x.battery))throw Error('バッテリーの測定項目を確認してください。');return UNKNOWN;}
  if(x?.pid){validatePid(x.pid,value=>evaluate(value,env));return UNKNOWN;}
  if(x?.numeric){const {op,a,b,low,high}=x.numeric;if(!['mod','random','min','max','clamp','round'].includes(op))throw Error('未対応のデータ演算です。');const values=[a,...(b===undefined?[]:[b]),...(op==='clamp'?[low,high]:[])].map(v=>evaluate(v,env));if(op==='mod'&&values[1]===0)throw Error('0では割れません。');if(op==='random'&&values.every(v=>v!==UNKNOWN)&&(Math.trunc(values[0])>Math.trunc(values[1])||values.some(v=>v< -32767||v>32767)))throw Error('乱数は−32767〜32767の整数範囲で、下限≦上限にしてください。');if(op==='clamp'&&values[1]!==UNKNOWN&&values[2]!==UNKNOWN&&values[1]>values[2])throw Error('範囲の下限を上限以下にしてください。');return UNKNOWN;}
  if(x?.textData){if(!['length','contains','equal','number'].includes(x.textData.op))throw Error('文字列の演算を確認してください。');checkText(x.textData.value);if(x.textData.other)checkText(x.textData.other);return UNKNOWN;}
  if(x?.listData){if(!['length','item','contains','sum','average','min','max'].includes(x.listData.op))throw Error('リストの演算を確認してください。');if(x.listData.index!==undefined)evaluate(x.listData.index,env);if(x.listData.value!==undefined)evaluate(x.listData.value,env);return UNKNOWN;}
  if(x?.math)return unaryValue(x.math.fn,evaluate(x.math.value,env));
  if(x?.timer!==undefined){if(x.timer!==true)throw Error('タイマーの指定が不正です。');return UNKNOWN;}
  if(x?.button){buttonConfiguration(x.button);return UNKNOWN;}
  if(x?.sensor){sensorConfiguration(x.sensor);return UNKNOWN;}
  if(x?.geometry){
    const geometry=env[GEOMETRY],diameter=geometry?.diameter10;
    if(!diameter)throw Error('距離で動かす前に、タイヤの直径を設定してください。');
    let value=evaluate(x.geometry.value,env);if(env[FLOATS]&&value!==UNKNOWN)value=Math.trunc(value);
    if(['spin','pivot'].includes(x.geometry.kind)){if(!geometry.tread10)throw Error('旋回の前に、トレッドを設定してください。');return value===UNKNOWN?UNKNOWN:Math.round(value*geometry.tread10*(x.geometry.kind==='pivot'?2:1)/diameter);}
    if(value===UNKNOWN)return UNKNOWN;
    return Math.round(value*360000/Math.round(diameter*31416/1000));
  }
  if(x?.var!==undefined)return env[PARALLEL]?UNKNOWN:env[GLOBALS]?.get(x.var)??0;
  if(x?.not!==undefined){const n=evaluate(x.not,env);return n===UNKNOWN?UNKNOWN:+!n;}
  if(x?.op){if(!Object.hasOwn(arithmetic,x.op))throw Error('未対応の計算です。');const a=evaluate(x.left,env),b=evaluate(x.right,env);if(x.op==='div'&&b===0)throw Error('0では割れません。');if(a===UNKNOWN||b===UNKNOWN)return UNKNOWN;const result=env[FLOATS]?Math.fround(x.op==='div'?a/b:arithmetic[x.op](a,b)):arithmetic[x.op](a,b);if(env[FLOATS])finiteNumber(result);else inRange(result,-2147483648,2147483647,'計算結果');return result;}
  if(x?.scaled){const n=evaluate(x.scaled.value,env);return n===UNKNOWN?UNKNOWN:env[FLOATS]?finiteNumber(Math.fround(n*x.scaled.factor/x.scaled.divisor)):Math.round(n*x.scaled.factor/x.scaled.divisor);}
  if (x && Object.hasOwn(env,x.param)) return env[x.param];
  throw Error(`引数「${x?.param ?? '?'}」は、このマイブロックの中だけで使用できます。`);
}
const scaled=(value,factor,divisor=1)=>typeof value==='number'?Math.round(value*factor/divisor):{scaled:{value,factor,divisor}};
// 移動・旋回などの上位命令をモーター命令へ展開する。タイヤ直径・トレッドの設定は実行順に従う。
// スピンはトレッド÷直径×旋回角、ピボットはその2倍。秒指定はミリ秒へ換算する。
function prepareProgram(input){
  if(!input || !Array.isArray(input.main) || !Array.isArray(input.procedures))return input;
  const pairs=movementPlan(input);
  const sequence=nodes=>nodes.flatMap(b=>{
    if(b.movement){
      const {movement,...command}=b;
      const variants=[...pairs].map(([id,pair])=>({id,...pair,body:sequence([{...command,...pair,ports:pair.leftPort|pair.rightPort}])}));
      return {type:'movement',variants,body:variants.flatMap(v=>v.body)};
    }
    if(b.type==='pivot'){
      if(![1,2,4,8].includes(b.leftPort)||![1,2,4,8].includes(b.rightPort)||b.leftPort===b.rightPort)throw Error('ピボットターンの左右には異なるモーターポートを選んでください。');
      if(!['left','right'].includes(b.direction))throw Error('ピボットターンの方向が不正です。');
      const moving=b.direction==='right'?b.leftPort:b.rightPort,stationary=b.direction==='right'?b.rightPort:b.leftPort;
      return [{type:'stop',ports:stationary},{...b,type:'motor',ports:moving,degrees:{geometry:{kind:'pivot',value:b.angle}},mode:'independent',pivotSource:b}];
    }
    if(b.type==='spin'){
      if(![1,2,4,8].includes(b.leftPort)||![1,2,4,8].includes(b.rightPort)||b.leftPort===b.rightPort)throw Error('スピンターンの左右には異なるモーターポートを選んでください。');
      if(!['left','right'].includes(b.direction))throw Error('スピンターンの方向が不正です。');
      const portDirections=Object.fromEntries([0,1,2,3].filter(i=>(b.leftPort|b.rightPort)&(1<<i)).map(i=>[i,((1<<i)===b.leftPort?1:-1)*(b.direction==='right'?1:-1)]));
      return {...b,type:'motor',ports:b.leftPort|b.rightPort,degrees:{geometry:{kind:'spin',value:b.angle}},mode:'feedback',portDirections,spinSource:b};
    }
    if(b.type==='drive'){
      if(![3,5,6,9,10,12].includes(b.ports))throw Error('走行用の異なる2個のモーターポートを選んでください。');
      if(!['forward','backward'].includes(b.direction))throw Error('走行方向が不正です。');
      return {...b,type:'motor',speed:scaled(b.speed,b.direction==='backward'?-1:1),degrees:{geometry:{kind:'distance',value:b.cm}},driveSource:b};
    }
    if(b.type==='motorRotations')return {...b,type:'motor',degrees:scaled(b.rotations,360)};
    if(b.type==='waitSeconds')return {type:'wait',ms:scaled(b.seconds,1000),secondsSource:b.seconds};
    if(b.type==='repeat'||b.type==='while'||b.type==='forever')return {...b,body:sequence(b.body)};
    if(b.type==='if')return {...b,then:sequence(b.then),else:sequence(b.else)};
    return b;
  });
  return {...input,threads:(input.threads??[]).map(t=>({...t,body:sequence(t.body)})),main:sequence(input.main),procedures:input.procedures.map(p=>({...p,body:sequence(p.body)}))};
}
// 中間データを実行前に点検する。呼び出し順、変数、寸法、再帰、値の範囲を確認する。
// 実行時に変化する値はここでは確定できないため、生成するVM命令側にも範囲検査を入れる。
export function validate(program) {
  program=prepareProgram(program);
  const floatingMode=true;
  if (!program || !Array.isArray(program.main) || (!program.main.length&&!program.threads?.length)) throw Error('「スタート」の下にブロックをつなげてください。');
  if (!Array.isArray(program.procedures) || program.procedures.length>32) throw Error('マイブロックは32個までです。');
  const map=new Map();
  for (const p of program.procedures) {
    if (!p.name || map.has(p.name)) throw Error('マイブロック名が重複しています。');
    if (p.params.length>8 || new Set(p.params).size!==p.params.length) throw Error('引数は重複のない名前で8個までです。');
    if(p.returns&&(procedureResults(p).length<1||procedureResults(p).length>8))throw Error('戻り値は1〜8個にしてください。');
    map.set(p.name,p);
  }
  const parallel=parallelPlan(program);
  let visits=0;
  const globals=new Map(),geometry={diameter10:0,tread10:0};
  function invoke(b,env,stack,wantsValue,allValues=false){
    const p=map.get(b.name); if(!p)throw Error(`マイブロック「${b.name}」の定義がありません。`);
    if(!!p.returns!==wantsValue)throw Error(wantsValue?'数値を返すマイブロックを選んでください。':'数値を返すマイブロックは値の入力欄で使ってください。');
    if(wantsValue&&!allValues&&(!Number.isInteger(b.output??0)||(b.output??0)<0||(b.output??0)>=procedureResults(p).length))throw Error('戻り値の選択を確認してください。');
    if(stack.includes(p.name))throw Error('試作版ではマイブロックの再帰呼び出しは使えません。');
    if(b.args.length!==p.params.length)throw Error(`「${p.name}」の引数の数が一致しません。`);
    const args=b.args.map(x=>evaluate(x,env)); args.forEach(n=>floatingMode?finiteNumber(n,'引数'):inRange(n,-2147483648,2147483647,'引数'));
    const next=Object.fromEntries(p.params.map((n,i)=>[n,args[i]]));next[GLOBALS]=globals;next[GEOMETRY]=geometry;next[FLOATS]=floatingMode;next[PARALLEL]=!!parallel;next[RETURNS]=[];next[VALUE_RETURN]=wantsValue?procedureResults(p).length:0;const exit=walk(p.body,next,[...stack,p.name]);if(exit==='programEnd')return allValues?procedureResults(p).map(()=>UNKNOWN):wantsValue?UNKNOWN:exit;
    // 途中で値を返した経路と末尾まで進む経路の状態を合流させる。
    const states=next[RETURNS];if(exit!=='myblockReturn'){const value=wantsValue?procedureResults(p).map(x=>evaluate(x,next)):undefined;states.push({globals:new Map(globals),geometry:{...geometry},value});}
    if(states.length){globals.clear();for(const state of states)for(const k of state.globals.keys())globals.set(k,0);for(const k of globals.keys()){const value=states[0].globals.get(k)??0;globals.set(k,states.every(s=>(s.globals.get(k)??0)===value)?value:UNKNOWN);}for(const k of Object.keys(geometry)){const value=states[0].geometry[k];geometry[k]=states.every(s=>s.geometry[k]===value)?value:0;}}

    if(wantsValue){const values=procedureResults(p).map((_,i)=>{const value=states[0]?.value?.[i]??UNKNOWN;return states.every(s=>s.value?.[i]===value)?value:UNKNOWN;});return allValues?values:values[b.output??0];}
  }
  // 検証中の状態を命令順に進める。programEndは全体終了、myblockReturnは呼び出し元へ戻る信号。
  function walk(nodes, env, stack) {
    env[CALL_VALUE]=b=>invoke(b,env,stack,true);
    for (const b of nodes) {
      let values=new WeakMap();env[CALL_VALUE]=b=>{if(!values.has(b))values.set(b,invoke(b,env,stack,true));return values.get(b);};
      if (++visits>20000) throw Error('実行する処理が多すぎます。繰り返し回数を減らしてください。');
      const sourceInt=x=>{const n=evaluate(x,env);return floatingMode&&n!==UNKNOWN?Math.trunc(n):n;};
      const val=k=>{if(k==='condition')values=new WeakMap();return floatingMode&&!['value','condition','seconds'].includes(k)?sourceInt(b[k]):evaluate(b[k],env);};
      switch(b.type) {
        case 'movementSetup':break;
        case 'movement':walk(b.variants[0]?.body??[],env,stack);break;
        case 'displayClear':case 'displayBitmap':case 'displayNumber':validateDisplay(b);if(b.type==='displayNumber')evaluate(b.value,env);break;
        case 'led':inRange(b.color,0,3,'ランプの色');if(!['on','flash','pulse'].includes(b.mode))throw Error('ランプの点灯方法を選んでください。');break;
        case 'steering':{if(![1,2,4,8].includes(b.leftPort)||![1,2,4,8].includes(b.rightPort)||b.leftPort===b.rightPort)throw Error('ステアリングの左右には異なるポートを選んでください。');inRange(val('speed'),-100,100,'速さ');inRange(val('turn'),-100,100,'ステアリング');if(!['run','angle','time'].includes(b.action))throw Error('ステアリングの動作を選んでください。');if(b.action!=='run'&&val('speed')===0)throw Error('有限走行の速さは0以外にしてください。');if(b.action==='angle')inRange(val('degrees'),1,36000,'外側モーターの角度');if(b.action==='time'){const t=evaluate(b.seconds,env);if(t!==UNKNOWN&&(!Number.isFinite(t)||t<=0||t>60))throw Error('走行時間は0より大きく60秒以下にしてください。');}break;}
        case 'textSet':checkText(b.value);break;
        case 'listAdd':case 'listSet':if(b.index!==undefined)inRange(val('index'),1,1000,'リストの番号');evaluate(b.value,env);break;
        case 'listDelete':inRange(val('index'),1,1000,'リストの番号');break;
        case 'listClear':case 'logStart':case 'logEnd':break;
        case 'logValue':checkText({text:b.label});if(isText(b.value))checkText(b.value);else evaluate(b.value,env);break;
        case 'ramp':if(!['off','trapezoid','scurve'].includes(b.mode))throw Error('加減速方式を選んでください。');for(const name of ['upSeconds','downSeconds']){const seconds=evaluate(b[name],env);if(seconds!==UNKNOWN&&(!Number.isFinite(seconds)||seconds<0||seconds>10))throw Error('加速・減速時間は0〜10秒にしてください。');}break;
        case 'wheel':if(!Number.isFinite(b.diameter)||b.diameter<10||b.diameter>200)throw Error('タイヤの直径は10〜200 mmにしてください。');geometry.diameter10=Math.round(b.diameter*10);break;
        case 'tread':if(!Number.isFinite(b.mm)||b.mm<10||b.mm>1000)throw Error('トレッドは10〜1000 mmにしてください。');geometry.tread10=Math.round(b.mm*10);break;
        case 'set':case 'change':{const a=val('value'),previous=b.type==='change'?(globals.get(b.var)??0):0,n=a===UNKNOWN||previous===UNKNOWN?UNKNOWN:a+previous;if(floatingMode){finiteNumber(n,'変数の値');globals.set(b.var,n===UNKNOWN?n:Math.fround(n));}else{inRange(n,-2147483648,2147483647,'変数の値');globals.set(b.var,n);}break;}
        case 'if':{const condition=val('condition');if(condition!==UNKNOWN){const exit=walk(condition?b.then:b.else,env,stack);if(exit)return exit;break;}
          const before=new Map(globals),settings={...geometry};const yesExit=walk(b.then,env,stack);const yes=new Map(globals),yesSettings={...geometry};globals.clear();for(const [k,v]of before)globals.set(k,v);Object.assign(geometry,settings);const noExit=walk(b.else,env,stack);
          if(yesExit&&noExit)return yesExit===noExit?yesExit:'myblockReturn';
          if(yesExit)break;
          if(noExit){globals.clear();for(const [k,v]of yes)globals.set(k,v);Object.assign(geometry,yesSettings);break;}
          for(const k of new Set([...yes.keys(),...globals.keys()]))if((yes.get(k)??0)!==(globals.get(k)??0))globals.set(k,UNKNOWN);
          for(const k of Object.keys(geometry))if(geometry[k]!==yesSettings[k])geometry[k]=0;break;}
        case 'forever':{
          // Inspect one conservative iteration; changing globals can have any
          // value on later iterations. Runtime operand guards enforce limits.
          const assignments=x=>{if(x&&typeof x==='object'){if(x.type==='set'||x.type==='change')globals.set(x.var,UNKNOWN);for(const value of Object.values(x))assignments(value);}};
          assignments(program);for(const key of globals.keys())globals.set(key,UNKNOWN);return walk(b.body,env,stack);
        }
        case 'while':{let count=0;while(true){const condition=val('condition');if(condition===UNKNOWN){for(const k of globals.keys())globals.set(k,UNKNOWN);const before={...geometry};walk(b.body,env,stack);for(const k of Object.keys(geometry))if(before[k]!==geometry[k])geometry[k]=0;for(const k of globals.keys())globals.set(k,UNKNOWN);break;}if(!!condition===!!b.until)break;if(++count>1000)throw Error('条件付き繰り返しは1000回以内に終わるようにしてください。変数の更新と条件を確認してください。');const exit=walk(b.body,env,stack);if(exit)return exit;}break;}
        case 'stopMode':inRange(b.ports,1,15,'モーターポート');if(!Object.hasOwn(stopModes,b.mode))throw Error('停止方法を選んでください。');break;
        case 'tankFinite':{
          if(![1,2,4,8].includes(b.leftPort)||![1,2,4,8].includes(b.rightPort)||b.leftPort===b.rightPort)throw Error('左右には異なるモーターポートを選んでください。');
          const left=val('leftSpeed'),right=val('rightSpeed');inRange(left,-100,100,'左モーターの速さ');inRange(right,-100,100,'右モーターの速さ');if(left===0&&right===0)throw Error('左右の速さを両方0にはできません。');
          if(b.action==='angle')inRange(val('degrees'),1,36000,'速い側のモーターの角度');else if(b.action==='time'){const seconds=evaluate(b.seconds,env);if(seconds!==UNKNOWN&&(!Number.isFinite(seconds)||seconds<.001||seconds>60))throw Error('走行時間は0.001〜60秒にしてください。');}else throw Error('走行の指定を確認してください。');break;
        }
        case 'motorPower':case 'motorSpeedSet':inRange(b.ports,1,15,'モーターポート');inRange(val('speed'),-100,100,'速度・パワー');break;
        case 'tank':if(![1,2,4,8].includes(b.leftPort)||![1,2,4,8].includes(b.rightPort)||b.leftPort===b.rightPort)throw Error('左右には異なるモーターポートを選んでください。');inRange(val('leftSpeed'),-100,100,'左モーターの速さ');inRange(val('rightSpeed'),-100,100,'右モーターの速さ');break;
        case 'motorRun':inRange(b.ports,1,15,'モーターポート');if(b.ports.toString(2).split('1').length-1>2)throw Error('モーターポートは2個まで指定できます。');inRange(val('speed'),-100,100,'速度');break;
        case 'motor': inRange(b.ports,1,15,'モーターポート'); inRange(val('speed'),-100,100,'速度');
          if(b.pivotSource){inRange(sourceInt(b.pivotSource.angle),1,3600,'ロボットの回転角度');inRange(val('speed'),-100,100,'ピボットターンの速さ（％）');}
          if(b.spinSource){inRange(sourceInt(b.spinSource.angle),1,3600,'ロボットの回転角度');inRange(val('speed'),-100,100,'スピンターンの速さ（％）');}
          if(b.driveSource){inRange(sourceInt(b.driveSource.cm),1,1000,'進む長さ（cm）');inRange(sourceInt(b.driveSource.speed),-100,100,'走行速度（％）');}
          if(b.mode!==undefined && !['independent','sync','feedback'].includes(b.mode))throw Error('2個のモーターの制御方式が不正です。');
          if(b.ports.toString(2).split('1').length-1>2)throw Error('1個のモーターブロックで指定できるポートは2個までです。');
          if(val('speed')===0) throw Error('角度指定のモーター速度を0にはできません。');
          inRange(val('degrees'),1,36000,'回転角度');
          if(b.mode==='feedback' && val('degrees')!==UNKNOWN && val('speed')!==UNKNOWN && val('degrees')*500/Math.abs(val('speed'))+5000>180000)throw Error('補正制御では、角度を減らすか速度を上げてください（監視時間の上限3分）。');
          break;
        case 'tone': inRange(val('frequency'),250,10000,'周波数'); inRange(val('ms'),1,30000,'音の長さ'); inRange(b.volume,0,100,'音量'); break;
        case 'wait': if(b.secondsSource!==undefined){const seconds=evaluate(b.secondsSource,env);if(seconds!==UNKNOWN&&(!Number.isFinite(seconds)||seconds<0||seconds>60))throw Error('待ち時間は0〜60秒にしてください。');} inRange(val('ms'),0,60000,'待ち時間'); break;
        case 'motorTimed': inRange(b.ports,1,15,'モーターポート');if(b.ports.toString(2).split('1').length-1>2)throw Error('モーターポートは2個まで指定できます。');inRange(val('speed'),-100,100,'モーターの速さ');if(val('speed')===0)throw Error('モーターの速さは0以外にしてください。');{const seconds=val('seconds');if(seconds!==UNKNOWN&&(!Number.isFinite(seconds)||seconds<=0||seconds>60))throw Error('モーターの時間は0より大きく60秒以下にしてください。');} break;
        case 'timerReset':break;
        case 'pidReset':pidName(b.name);break;
        case 'gyroReset':sensorConfiguration({kind:'gyroAngle',port:b.port});break;
        case 'encoderReset':inRange(b.port,1,4,'リセットするモーターポート');break;
        case 'broadcast':if(typeof b.message!=='string'||!b.message.trim()||b.message.length>40||b.message.includes('\0'))throw Error('メッセージ名は1〜40文字にしてください。');break;
        case 'programEnd':return 'programEnd';
        case 'returnValue':case 'returnValues':if(!stack.length||!env[VALUE_RETURN])throw Error('値を返す終了ブロックは、数値を返すマイブロックの中だけで使えます。');{const expressions=b.type==='returnValues'?b.values:[b.value];if(expressions.length!==env[VALUE_RETURN])throw Error('返す値の数を定義の戻り値とそろえてください。');const value=expressions.map(x=>evaluate(x,env));value.forEach(n=>finiteNumber(n,'戻り値'));env[RETURNS].push({globals:new Map(globals),geometry:{...geometry},value});return 'myblockReturn';}
        case 'myblockReturn':if(env[VALUE_RETURN])throw Error('数値を返すマイブロックでは、値を返す終了ブロックを使ってください。');if(!stack.length)throw Error('マイブロックの終了は定義の中だけで使えます。');env[RETURNS].push({globals:new Map(globals),geometry:{...geometry}});return 'myblockReturn';
        case 'stop': if(b.stopMode!==undefined&&!Object.hasOwn(stopModes,b.stopMode))throw Error('停止方法を選んでください。');if(b.ports!==undefined)inRange(b.ports,1,15,'停止するモーターポート');break;
        case 'repeat': {const n=val('count'); inRange(n,0,1000,'繰り返し回数'); if(n===UNKNOWN){for(const k of globals.keys())globals.set(k,UNKNOWN);const before={...geometry};walk(b.body,env,stack);for(const k of Object.keys(geometry))if(before[k]!==geometry[k])geometry[k]=0;for(const k of globals.keys())globals.set(k,UNKNOWN);}else for(let i=0;i<n;i++){const exit=walk(b.body,env,stack);if(exit)return exit;} break;}
        case 'callOutputs':{const outputs=invoke(b,env,stack,true,true);if(!Array.isArray(b.targets)||b.targets.length!==outputs.length||b.targets.some(n=>typeof n!=='string'||!n))throw Error('戻り値を受け取る変数を選んでください。');b.targets.forEach((name,i)=>globals.set(name,outputs[i]));break;}
        case 'call':if(invoke(b,env,stack,false)==='programEnd')return 'programEnd';break;
        default: throw Error(`未対応のブロック: ${b.type}`);
      }
    }
  }
  for(const root of parallel?.roots??[{body:program.main}]){
    globals.clear();Object.assign(geometry,{diameter10:0,tread10:0});
    const env={[GLOBALS]:globals,[GEOMETRY]:geometry,[FLOATS]:floatingMode,[PARALLEL]:!!parallel};
    env[CALL_VALUE]=b=>invoke(b,env,[],true);if(root.condition!==undefined)evaluate(root.condition,env);
    walk(root.body,env,[]);
  }
  return {map,visits};
}
// 検証済みの中間データをRBFへ組み立てる。返り値には本体用dataと診断用の補助情報を含む。
// 通常変数は共有メモリ、引数と作業領域は各オブジェクトのローカルメモリに割り当てる。
export function compile(program,folder='EV3Lab') {
  const directory=projectDirectory(folder),usesFloat=true;
  program=prepareProgram(program);
  validate(program);
  const parallel=parallelPlan(program);
  const variableNames=new Set();let usesGeometry=false,usesSensors=false,usesForever=false,usesRamps=false,usesTimer=false,usesStopModes=false,usesGyro=false,usesMovement=false;
  const collect=x=>{if(x&&typeof x==='object'){if(['movement','movementSetup'].includes(x.type))usesMovement=true;if(x.sensor?.kind?.startsWith('gyro')||x.type==='gyroReset'){usesGyro=true;usesSensors=true;}if(x.type==='stopMode'||x.stopMode!==undefined)usesStopModes=true;if(x.timer===true||x.type==='timerReset'){usesTimer=true;usesSensors=true;}if(x.type==='forever')usesForever=true;if(x.type==='ramp')usesRamps=true;if(x.sensor||x.battery||x.pid||x.button||x.type==='encoderReset')usesSensors=true;if(x.geometry||x.type==='wheel'||x.type==='tread')usesGeometry=true;if(typeof x.var==='string')variableNames.add(x.var);if(x.type==='callOutputs')for(const name of x.targets??[])variableNames.add(name);for(const v of Object.values(x))collect(v);}};
  collect(program);if(variableNames.size>32)throw Error('変数は32個までです。');
  // 通常変数・寸法・加減速設定・共有タイマーを重ならない位置へ配置する。各数値の領域は4バイト。
  const globalOffsets=new Map([...variableNames].map((name,i)=>[name,i*4]));
  const diameterOffset=globalOffsets.size*4,treadOffset=diameterOffset+4,rampOffset=diameterOffset+(usesGeometry?8:0);
  const timerOffset=rampOffset+(usesRamps?12:0);
  const stopModeOffset=timerOffset+(usesTimer?4:0);
  // 角度のゼロ点はポート別・プログラム全体で共有。物理的な再校正やモード切替はしない。
  const gyroOffset=stopModeOffset+(usesStopModes?16:0);
  const movementOffset=gyroOffset+(usesGyro?16:0);
  const baseGlobalBytes=movementOffset+(usesMovement?4:0);
  const pids=pidLayout(program,baseGlobalBytes),dataBase=baseGlobalBytes+pids.bytes;
  const extras=extraLayout(program,dataBase,directory);
  // Bind a diagnostic record to this compiler revision and exact project.
  let diagnosticTag=0x811c9dc5;
  for(const ch of new TextEncoder().encode('timing-v1-0.1.6|'+JSON.stringify(program)))diagnosticTag=Math.imul(diagnosticTag^ch,0x01000193);
  const diagnosticPath=`${directory}/FB_${(diagnosticTag>>>0).toString(16).padStart(8,'0')}.bin`;
  let recordsTiming=false;
  const procs=program.procedures;
  const roots=parallel?.roots??[];
  const messageBase=dataBase+extras.bytes;
  const ackBase=messageBase+(parallel?.messages.size??0)*4;
  const lockBase=ackBase+roots.length*4;
  const globalBytes=parallel?lockBase+roots.length*8:dataBase+extras.bytes;
  const messageAt=name=>globalVar(messageBase+parallel.messages.get(name)*4);
  const ackAt=i=>globalVar(ackBase+i*4);
  const needed=roots.map(r=>{const names=new Set();parallel.visit([r.condition,r.body],b=>{if(b.type==='call')names.add(b.name);});return names;});
  const specs=parallel?[{boot:true,params:[],body:[],name:'並行処理の初期化'},
    ...roots.map((r,i)=>({...r,root:i,params:[],name:r.name??(r.kind==='message'?'受信 '+r.message:r.kind==='start'?'スタート'+(i+1):'イベント'+(i+1))})),
    ...roots.flatMap((_,root)=>procs.filter(p=>needed[root].has(p.name)).map(p=>({...p,subcall:true,root})))]:[{params:[],body:program.main,name:'メイン'},...procs.map(p=>({...p,subcall:true}))];
  const objects=specs.map((p,index)=>{
    const ids=new Map(specs.flatMap((s,i)=>s.subcall&&s.root===p.root?[[s.name,i+1]]:[]));
    const code=p.subcall ? [p.params.length+procedureResults(p).length,...p.params.map(()=>usesFloat?0x83:0x82),...procedureResults(p).map(()=>0x43)] : [];
    let bytes=(p.params.length+procedureResults(p).length)*4;
    const alloc=()=>{const at=bytes;bytes+=4;return at;};
    const timer=alloc();
    const emit=(op,...args)=>code.push(op,...args.flat());
    const faults=[],movementFaults=[];
    const lock=parallel&&!p.boot?sharedLock({emit,alloc,local,globalVar,constant,jump:(...args)=>jump(...args),patch:(...args)=>patch(...args),position:()=>code.length,guard:(...args)=>guard(...args)},p.root,roots.length,lockBase):null;
    let lockDepth=0;
    const locked=fn=>{if(!lock||lockDepth)return fn();lock.acquire();lockDepth++;const result=fn();lockDepth--;lock.release();return result;};
    // 整数を要求するハードウェア命令やセンサ値を扱う層。出力マスクと入力ポート番号の取り違えに注意。
    const integerExpr=(x,{rawGyro=false}={})=>{
      if(typeof x==='number')return constant(x);
      if(x?.register!==undefined)return local(x.register);
      if(x?.button){
        const result=local(alloc());emit(OP.MOVE32,constant(0),result);
        for(const id of buttonConfiguration(x.button)){
          const pressed=local(alloc());emit(OP.MOVE32,constant(0),pressed);
          // UI_BUTTON PRESSED returns DATA8. Keep upper bytes clear for DATA32.
          emit(0x83,constant(9),constant(id),pressed);emit(0x22,result,pressed,result);
        }
        return result;
      }
      if(x?.sensor){
        const {kind,port,channel}=x.sensor,config=sensorConfiguration(x.sensor),result=local(alloc());
        const actualType=local(alloc()),actualMode=local(alloc());
        emit(OP.MOVE32,constant(0),actualType);emit(OP.MOVE32,constant(0),actualMode);
        if(config.encoder||config.motor){
          // Output ports are numbered 16..19 by INPUT_DEVICE, but 0..3 by
          // OUTPUT_GET_COUNT. Read the sensor counter without resetting it.
          emit(OP.INPUT_DEVICE,constant(5),constant(0),constant(15+port),actualType,actualMode);guard(actualType,7,8);
          if(config.motor){const raw=local(alloc()),steps=local(alloc());emit(OP.MOTOR_READ,constant(0),constant(port-1),raw,steps);emit(0x32,raw,result);guard(result,-100,100);}
          else emit(OP.MOTOR_COUNT,constant(0),constant(port-1),result);return result;
        }
        const raw=Array.from({length:config.count??1},()=>local(alloc()));
        emit(OP.INPUT_DEVICE,constant(29),constant(0),constant(port-1),constant(config.type),constant(config.mode),constant(raw.length),...raw);
        emit(OP.INPUT_DEVICE,constant(5),constant(0),constant(port-1),actualType,actualMode);guard(actualType,config.type,config.type);guard(actualMode,config.mode,config.mode);
        if(kind.startsWith('irBeacon')){
          const heading=raw[(channel-1)*2],distance=raw[(channel-1)*2+1];
          // IR-SEEK's absent beacon is DATA8_NAN (-128), normally converted
          // to DATAF NaN by stock firmware. This is not a missing sensor.
          emit(OP.MOVE32,constant(kind==='irBeaconDistance'?100:0),result);
          const absent=jump(OP.JR_LT32,[floatCompare(0x4f,distance,distance),constant(1)]);
          const absentRaw=jump(OP.JR_GT32,[floatCompare(0x4f,distance,floatingConstant(-128)),constant(0)]);
          floatGuard(distance);const d=local(alloc());emit(OP.MOVEF32,distance,d);guard(d,0,100);
          if(kind==='irBeaconDetected')emit(OP.MOVE32,constant(1),result);
          else{const source=kind==='irBeaconHeading'?heading:distance;floatGuard(source);emit(OP.MOVEF32,source,result);guard(result,config.min,config.max);}
          patch(absent,code.length);patch(absentRaw,code.length);return result;
        }
        const source=raw[kind==='irRemote'?channel-1:(config.index??0)];floatGuard(source);
        emit(OP.MOVEF32,source,result);guard(result,config.min,config.max);
        // 同じ GYRO-G&A モードの2データから選ぶ。読み取りのたびに角度を消さない。
        if(kind==='gyroAngle'&&!rawGyro)emit(OP.SUB32,result,globalVar(gyroOffset+4*(port-1)),result);
        return result;
      }
      if(x?.geometry){
        const value=expr(x.geometry.value),result=local(alloc()),divisor=local(alloc()),half=local(alloc());
        if(['spin','pivot'].includes(x.geometry.kind)){
          emit(OP.MUL32,value,globalVar(treadOffset),result);if(x.geometry.kind==='pivot')emit(OP.MUL32,result,constant(2),result);emit(OP.MOVE32,globalVar(diameterOffset),divisor);
        }else{
          emit(OP.MUL32,globalVar(diameterOffset),constant(31416),divisor);emit(OP.ADD32,divisor,constant(500),divisor);emit(OP.DIV32,divisor,constant(1000),divisor);
          emit(OP.MUL32,value,constant(360000),result);
        }
        emit(OP.DIV32,divisor,constant(2),half);emit(OP.ADD32,result,half,result);emit(OP.DIV32,result,divisor,result);return result;
      }
      if(x?.var!==undefined){if(!globalOffsets.has(x.var))throw Error('変数が見つかりません。');return globalVar(globalOffsets.get(x.var));}
      if(x?.not!==undefined)return expr({op:'eq',left:x.not,right:0});
      if(x?.op){
        const left=expr(x.left),right=expr(x.right),result=local(alloc());
        const math={add:OP.ADD32,sub:OP.SUB32,mul:OP.MUL32,div:OP.DIV32};
        if(math[x.op]){if(x.op==='div'&&(usesSensors||usesForever||usesFloat))nonzero(right);emit(math[x.op],left,right,result);}
        else if(x.op==='and'||x.op==='or'){const a=exprCompare(left,constant(0)),b=exprCompare(right,constant(0));emit(x.op==='and'?0x26:0x22,a,b,result);}
        else {const cp={lt:0x46,gt:0x4a,eq:0x4e,neq:0x52,lte:0x56,gte:0x5a}[x.op];if(cp===undefined)throw Error('未対応の比較です。');emit(OP.MOVE32,constant(0),result);emit(cp,left,right,result);}
        return result;
      }
      if(x?.scaled){const {value,factor,divisor}=x.scaled,result=local(alloc());emit(OP.MUL32,expr(value),constant(factor),result);if(divisor!==1){emit(OP.ADD32,result,constant(Math.floor(divisor/2)),result);emit(OP.DIV32,result,constant(divisor),result);}return result;}
      const i=p.params.indexOf(x?.param);
      if(i<0)throw Error(`引数「${x?.param}」はマイブロックの中だけで使用できます。`);
      return local(i*4);
    };
    // ジャンプ先はまだ決まらないため仮の相対アドレスを入れ、ブロック生成後にpatchで確定する。
    const jump=(op,args,target)=>{code.push(op,...args.flat(),0x83,...u32(target ?? 0)); return code.length-4;};
    const patch=(at,target)=>code.splice(at,4,...u32(target-(at+4)));
    const guard=(value,min,max)=>{faults.push(jump(OP.JR_LT32,[value,constant(min)]),jump(OP.JR_GT32,[value,constant(max)]));};
    const nonzero=value=>{const ok=exprCompare(value,constant(0));faults.push(jump(OP.JR_LT32,[ok,constant(1)]));};
    const exprCompare=(a,b)=>{const result=local(alloc());emit(OP.MOVE32,constant(0),result);emit(0x52,a,b,result);return result;};
    const floatCompare=(op,a,b)=>{const result=local(alloc());emit(OP.MOVE32,constant(0),result);emit(op,a,b,result);return result;};
    // NaN・無限大・範囲外を検出したら共通エラー処理へ飛ぶ。実行中の異常値をモーターに渡さない。
    const floatGuard=value=>{
      faults.push(jump(OP.JR_LT32,[floatCompare(0x4f,value,value),constant(1)]));
      faults.push(jump(0x67,[value,floatingConstant(-MAX_FLOAT)]),jump(0x6b,[value,floatingConstant(MAX_FLOAT)]));
    };
    const floatNonzero=value=>faults.push(jump(OP.JR_LT32,[floatCompare(0x53,value,floatingConstant(0)),constant(1)]));
    const asFloat=value=>{const result=local(alloc());emit(0x3b,value,result);return result;};
    // ユーザーの式・変数・引数は常に小数で計算する。ハードウェアへ渡す直前だけexprで整数に変換する。
    // 全出力を呼び出し側のローカル領域に受け取る。変数への代入は呼び出し完了後に行う。
    const callResults=call=>{
      const suspended=!!(lock&&lockDepth);if(suspended){lockDepth--;lock.release();}
      const id=ids.get(call.name),definition=procs.find(x=>x.name===call.name);if(!id||!definition)throw Error('戻り値のマイブロックが見つかりません。');
      const args=call.args.map(floatExpr),results=procedureResults(definition).map(()=>local(alloc()));
      emit(OP.CALL,constant(id),constant(args.length+results.length),...args,...results);
      if(suspended){lock.acquire();lockDepth++;}results.forEach(floatGuard);return results;
    };
    const returnResults=expressions=>{const values=expressions.map(floatExpr);values.forEach(floatGuard);values.forEach((value,i)=>emit(0x3f,value,local((p.params.length+i)*4)));emit(OP.RETURN);};
    let returnedValues=new WeakMap();
    const floatExpr=x=>{
      if(typeof x==='number')return floatingConstant(x);
      if(x?.callValue){
        if(returnedValues.has(x))return returnedValues.get(x);
        const results=callResults(x.callValue),result=results[x.callValue.output??0];returnedValues.set(x,result);return result;
      }
      if(x?.battery!==undefined){const result=local(alloc());emit(0x81,constant(x.battery==='voltage'?1:2),result);floatGuard(result);return result;}
      if(x?.pid)return locked(()=>pidOps.compute(x.pid));
      if(x?.timer===true){const elapsed=local(alloc()),seconds=local(alloc());emit(OP.TIMER_READ,elapsed);emit(OP.SUB32,elapsed,globalVar(timerOffset),elapsed);emit(0x1f,asFloat(elapsed),floatingConstant(1000),seconds);return seconds;}
      if(x?.numeric){const {op,a,b,low,high}=x.numeric,A=floatExpr(a),r=local(alloc());floatGuard(A);if(op==='round'){const t=local(alloc());emit(0x13,A,floatingConstant(.5),t);emit(0x8d,constant(3),t,r);return r;}const B=b===undefined?null:floatExpr(b);if(B)floatGuard(B);if(op==='mod'){floatNonzero(B);emit(0x8d,constant(2),A,B,r);const zero=jump(OP.JR_LT32,[floatCompare(0x53,r,floatingConstant(0)),constant(1)]),positive=local(alloc());emit(0x1b,r,B,positive);const same=jump(0x6b,[positive,floatingConstant(0)]);emit(0x13,r,B,r);patch(zero,code.length);patch(same,code.length);return r;}if(op==='random'){const from=expr(a),to=expr(b);guard(from,-32767,32767);guard(to,-32767,32767);faults.push(jump(OP.JR_GT32,[from,to]));const n=local(alloc());emit(OP.MOVE32,constant(0),n);emit(0x8e,from,to,n);const signed=local(alloc());emit(0x36,n,signed);return asFloat(signed);}if(op==='clamp'){const lo=floatExpr(low),hi=floatExpr(high);floatGuard(lo);floatGuard(hi);faults.push(jump(0x6b,[lo,hi]));emit(0x3f,A,r);const ok=jump(0x6b,[r,lo]);emit(0x3f,lo,r);patch(ok,code.length);const ok2=jump(0x67,[r,hi]);emit(0x3f,hi,r);patch(ok2,code.length);return r;}emit(0x3f,A,r);const keep=jump(op==='min'?0x67:0x6b,[A,B]);emit(0x3f,B,r);patch(keep,code.length);return r;}
      if(x?.textData||x?.listData)return locked(()=>dataOps.numeric(x));
      if(x?.var!==undefined){const value=local(alloc());emit(0x3f,globalVar(globalOffsets.get(x.var)),value);return value;}
      if(x?.param!==undefined){const i=p.params.indexOf(x.param);if(i<0)throw Error('引数の定義を確認してください。');return local(i*4);}
      if(x?.math){
        const {fn,value}=x.math,code=unaryCodes[fn];if(code===undefined)throw Error('未対応の数値関数です。');
        const input=floatExpr(value),result=local(alloc());floatGuard(input);
        if(fn==='sqrt')faults.push(jump(0x67,[input,floatingConstant(0)]));
        if(['ln','log'].includes(fn)){floatNonzero(input);faults.push(jump(0x67,[input,floatingConstant(0)]));}
        if(['asin','acos'].includes(fn))faults.push(jump(0x67,[input,floatingConstant(-1)]),jump(0x6b,[input,floatingConstant(1)]));
        if(fn==='tan'){const reduced=local(alloc());emit(0x8d,constant(2),input,floatingConstant(180),reduced);for(const n of [-90,90])faults.push(jump(OP.JR_GT32,[floatCompare(0x4f,reduced,floatingConstant(n)),constant(0)]));}
        if(fn==='pow10')emit(0x8d,constant(code),floatingConstant(10),input,result);else emit(0x8d,constant(code),input,result);
        floatGuard(result);return result;
      }
      if(x?.not!==undefined)return asFloat(floatCompare(0x4f,floatExpr(x.not),floatingConstant(0)));
      if(x?.op){
        const left=floatExpr(x.left),right=floatExpr(x.right),result=local(alloc()),math={add:0x13,sub:0x17,mul:0x1b,div:0x1f};
        if(math[x.op]){if(x.op==='div')floatNonzero(right);emit(math[x.op],left,right,result);floatGuard(result);return result;}
        if(x.op==='and'||x.op==='or'){const a=floatCompare(0x53,left,floatingConstant(0)),b=floatCompare(0x53,right,floatingConstant(0));emit(x.op==='and'?0x26:0x22,a,b,result);return asFloat(result);}
        const comparison={lt:0x47,gt:0x4b,eq:0x4f,neq:0x53,lte:0x57,gte:0x5b}[x.op];if(!comparison)throw Error('未対応の比較です。');return asFloat(floatCompare(comparison,left,right));
      }
      if(x?.scaled){const result=local(alloc());emit(0x1b,floatExpr(x.scaled.value),floatingConstant(x.scaled.factor),result);if(x.scaled.divisor!==1)emit(0x1f,result,floatingConstant(x.scaled.divisor),result);floatGuard(result);return result;}
      return asFloat(integerExpr(x)); // geometry, integer sensor reads and cached operands
    };
    const expr=x=>{
      if(!usesFloat)return integerExpr(x);
      // Hardware operands are integers; do not round intermediate calculations.
      if(typeof x==='number')return constant(Math.trunc(finiteNumber(Math.fround(x))));
      const value=floatExpr(x),result=local(alloc());floatGuard(value);emit(OP.MOVEF32,value,result);return result;
    };
    const pidOps=pidEmitter({emit,alloc,local,globalVar,constant,floatConstant:floatingConstant,floatExpr,asFloat,floatGuard,jump,patch,position:()=>code.length},pids);
    const motors=motorFeatures({emit,alloc,local,globalVar,constant,expr,guard,nonzero,jump,patch,position:()=>code.length},usesStopModes,stopModeOffset);
    const dataOps=dataEmitter({emit,alloc,local,globalVar,constant,zstr,floatExpr,expr,asFloat,guard,floatGuard,jump,patch,faults,floatConstant:floatingConstant,position:()=>code.length},extras);
    // 2個のモーターの進み具合をエンコーダで比較し、先行側の速度を調整する試作の補正制御。
    // 目標角度を優先し、停止時刻と途中経過を診断ファイルへ記録する。実行はすべてEV3内で行う。
    const feedbackPair=b=>{
      recordsTiming=true;
      const ports=[0,1,2,3].filter(i=>b.ports&(1<<i));
      const reg=()=>local(alloc());
      const direction=reg(),base=reg(),limit=reg(),began=reg(),elapsed=reg(),sum=reg(),cap=reg();
      // 左右の回転方向に、速度の正負も掛け合わせる。進捗計測と補正指令で同じ符号を使う。
      const signs=b.portDirections?Object.fromEntries(ports.map(port=>[port,reg()])):null;
      const portDirection=port=>signs?signs[port]:direction;
      const start=ports.map(reg),current=ports.map(reg),progress=ports.map(reg),remaining=ports.map(reg),busy=ports.map(reg),speed=ports.map(reg),difference=ports.map(reg);
      const threshold=reg(),handle=reg(),recordAt=bytes;bytes+=17*4;
      const record=Array.from({length:17},(_,i)=>local(recordAt+4*i));
      const writeReport=outcome=>{
        ports.forEach((port,i)=>{emit(OP.MOTOR_COUNT,constant(0),constant(port),current[i]);emit(OP.SUB32,current[i],start[i],record[8+i]);});
        emit(OP.MOVE32,constant(outcome),record[16]);
        emit(0xc0,constant(2),[0x84,...zstr(diagnosticPath)],handle);
        emit(0xc0,constant(29),handle,constant(68),local(recordAt));
        emit(0xc0,constant(7),handle);
      };
      [0x314d4954,diagnosticTag,b.ports].forEach((n,i)=>emit(OP.MOVE32,constant(n),record[i]));
      emit(OP.MOVE32,expr(b.speed),record[3]);emit(OP.MOVE32,expr(b.degrees),record[4]);
      for(const i of [6,7,10,11,12,13,14,15])emit(OP.MOVE32,constant(-1),record[i]);
      emit(OP.MOVE32,constant(1),direction);emit(OP.MOVE32,expr(b.speed),base);
      const positive=jump(OP.JR_GT32,[base,constant(0)]);
      emit(OP.MOVE32,constant(-1),direction);emit(OP.SUB32,constant(0),base,base);patch(positive,code.length);
      if(signs)ports.forEach(port=>emit(OP.MUL32,direction,constant(b.portDirections[port]),signs[port]));
      // Generous watchdog scaled to distance and nominal speed. This bounds a
      // stalled/disconnected motor without accepting an incomplete movement.
      emit(OP.MUL32,expr(b.degrees),constant(500),limit);emit(OP.DIV32,limit,base,limit);emit(OP.ADD32,limit,constant(5000),limit);if(usesSensors||usesForever||usesFloat)guard(limit,1,180000);
      emit(OP.MOTOR_RESET,constant(0),constant(b.ports));
      ports.forEach((port,i)=>{emit(OP.MOTOR_COUNT,constant(0),constant(port),start[i]);emit(OP.MOVE32,constant(0),busy[i]);});
      emit(OP.TIMER_READ,began);
      emit(OP.MOVE32,began,record[5]);
      if(b.portDirections){
        // Queue both finite movements before waiting. Each shaft has its own
        // direction; progress feedback compares absolute forward progress.
        ports.forEach(port=>emit(OP.MOTOR,constant(0),constant(1<<port),expr(scaled(b.speed,b.portDirections[port])),constant(0),expr(b.degrees),constant(0),motors.nativeBrake(1<<port)));
      }else motors.finite(OP.MOTOR,b.ports,expr(b.speed),expr(b.degrees));
      const loop=code.length;
      ports.forEach((port,i)=>emit(OP.MOTOR_TEST,constant(0),constant(1<<port),busy[i]));
      emit(OP.TIMER_READ,elapsed);emit(OP.SUB32,elapsed,began,elapsed);
      ports.forEach((port,i)=>{
        const stillRunning=jump(OP.JR_GT32,[busy[i],constant(0)]),alreadyRecorded=jump(OP.JR_GT32,[record[6+i],constant(-1)]);
        emit(OP.MOVE32,elapsed,record[6+i]);patch(stillRunning,code.length);patch(alreadyRecorded,code.length);
      });
      emit(OP.ADD32,busy[0],busy[1],sum);
      const complete=jump(OP.JR_LT32,[sum,constant(1)]);
      const timeout=jump(OP.JR_GT32,[elapsed,limit]);
      ports.forEach((port,i)=>{
        emit(OP.MOTOR_COUNT,constant(0),constant(port),current[i]);
        emit(OP.SUB32,current[i],start[i],progress[i]);emit(OP.MUL32,progress[i],portDirection(port),progress[i]);
        emit(OP.SUB32,expr(b.degrees),progress[i],remaining[i]);
      });
      for(let quarter=1;quarter<=3;quarter++){
        emit(OP.MUL32,expr(b.degrees),constant(quarter),threshold);emit(OP.DIV32,threshold,constant(4),threshold);
        ports.forEach((port,i)=>{
          const stamp=record[10+(quarter-1)*2+i];
          const recorded=jump(OP.JR_GT32,[stamp,constant(-1)]),notReached=jump(OP.JR_LT32,[progress[i],threshold]);
          emit(OP.MOVE32,elapsed,stamp);patch(recorded,code.length);patch(notReached,code.length);
        });
      }
      emit(OP.MOVE32,base,cap);
      const notNear0=jump(OP.JR_GT32,[remaining[0],constant(30)]),notNear1=jump(OP.JR_GT32,[remaining[1],constant(30)]);
      const alreadySlow=jump(OP.JR_LT32,[cap,constant(11)]);
      emit(OP.MOVE32,constant(10),cap);
      for(const at of [notNear0,notNear1,alreadySlow])patch(at,code.length);
      ports.forEach((port,i)=>{
        emit(OP.MOVE32,cap,speed[i]);
        emit(OP.SUB32,progress[i],progress[1-i],difference[i]);
        const notAhead=jump(OP.JR_LT32,[difference[i],constant(1)]);
        emit(OP.MUL32,difference[i],constant(2),difference[i]);emit(OP.SUB32,cap,difference[i],speed[i]);
        const nonnegative=jump(OP.JR_GT32,[speed[i],constant(-1)]);
        emit(OP.MOVE32,constant(0),speed[i]);patch(nonnegative,code.length);patch(notAhead,code.length);
        emit(OP.MUL32,speed[i],portDirection(port),speed[i]);
        const stopped=jump(OP.JR_LT32,[busy[i],constant(1)]);
        // OUTPUT_SPEED adjusts an active independent STEP_SPEED target without
        // replacing its finite angle limit. Never restart a completed motor.
        emit(OP.MOTOR_SPEED,constant(0),constant(1<<port),speed[i]);patch(stopped,code.length);
      });
      emit(OP.WAIT,constant(20),local(timer));emit(OP.READY,local(timer));
      const again=jump(OP.JR,[]);patch(again,loop);
      patch(timeout,code.length);
      emit(OP.STOP,constant(0),constant(15),constant(1));
      writeReport(1);
      emit(OP.SOUND,constant(1),constant(25),constant(300),constant(600));emit(OP.SOUND_READY);
      emit(OP.PROGRAM_STOP,constant(-1));
      patch(complete,code.length);
      writeReport(0);
    };
    // 20 ms velocity-command profiles run entirely in the EV3 VM. Native
    // finite STEP_SPEED targets remain active while OUTPUT_SPEED is updated.
    // Position feedback takes priority over the requested ramp duration.
    // 台形・S字の速度指令を20msごとに本体内で更新する。角度指定では目標位置を優先する。
    // S字はsmoothstepの速度曲線であり、一定ジャークを段階的に切り替える7区間方式ではない。
    const rampedMotion=b=>{
      const reg=()=>local(alloc()),c=constant;
      const mode=globalVar(rampOffset),up=reg(),down=reg(),base=reg(),sign=reg(),cap=reg(),began=reg(),elapsed=reg(),limit=reg();
      const ports=[0,1,2,3].filter(i=>b.ports&(1<<i)),timed=b.type==='motorTimed';
      const weighted=!!b.portSpeeds;
      const signs=b.portDirections||weighted?Object.fromEntries(ports.map(port=>[port,reg()])):null;
      const weights=weighted?ports.map(reg):null,ratioBase=weighted?reg():null,targets=weighted&&!timed?ports.map(reg):null;
      const direction=port=>signs?signs[port]:sign;
      const finishes=[];
      const clamp=(value,min,max)=>{const above=jump(OP.JR_GT32,[value,c(min-1)]);emit(OP.MOVE32,c(min),value);patch(above,code.length);const below=jump(OP.JR_LT32,[value,c(max+1)]);emit(OP.MOVE32,c(max),value);patch(below,code.length);};
      // Q1000 smoothstep: 3u²−2u³ has zero acceleration at both ends.
      // Intermediate products stay <= 1e9, inside signed EV3 DATA32.
      const curve=(time,duration)=>{
        const u=reg(),tmp=reg(),factor=reg();
        emit(OP.MUL32,time,c(1000),u);emit(OP.DIV32,u,duration,u);clamp(u,0,1000);
        const linear=jump(OP.JR_LT32,[mode,c(2)]);
        emit(OP.MUL32,u,u,tmp);emit(OP.MUL32,u,c(2),factor);emit(OP.SUB32,c(3000),factor,factor);emit(OP.MUL32,tmp,factor,u);emit(OP.DIV32,u,c(1000000),u);
        patch(linear,code.length);return u;
      };
      emit(OP.MOVE32,globalVar(rampOffset+4),up);emit(OP.MOVE32,globalVar(rampOffset+8),down);
      emit(OP.MOVE32,expr(b.speed),base);guard(base,-100,100);nonzero(base);emit(OP.MOVE32,c(1),sign);
      const positive=jump(OP.JR_GT32,[base,c(0)]);emit(OP.MOVE32,c(-1),sign);emit(OP.SUB32,c(0),base,base);patch(positive,code.length);
      if(weighted){
        // 左右の指定速度の比率と符号を保存する。短時間走行でピークを下げても比率は変えない。
        emit(OP.MOVE32,base,ratioBase);
        ports.forEach((port,i)=>{emit(OP.MOVE32,expr(b.portSpeeds[port]),weights[i]);guard(weights[i],-100,100);emit(OP.MOVE32,c(1),signs[port]);const positive=jump(OP.JR_GT32,[weights[i],c(-1)]);emit(OP.MOVE32,c(-1),signs[port]);emit(OP.SUB32,c(0),weights[i],weights[i]);patch(positive,code.length);});
      }else if(signs)ports.forEach(port=>emit(OP.MUL32,sign,c(b.portDirections[port]),signs[port]));
      const target=reg();emit(OP.MOVE32,expr(timed?(b.secondsAreMs?b.seconds:scaled(b.seconds,1000)):b.degrees),target);guard(target,1,timed?60000:36000);
      if(targets)ports.forEach((port,i)=>{emit(OP.MUL32,target,weights[i],targets[i]);emit(OP.DIV32,ratioBase,c(2),cap);emit(OP.ADD32,targets[i],cap,targets[i]);emit(OP.DIV32,targets[i],ratioBase,targets[i]);});
      const portTarget=i=>targets?targets[i]:target;
      const signedSpeed=(i,value)=>{
        if(weighted){emit(OP.MUL32,value,weights[i],value);emit(OP.DIV32,value,ratioBase,value);
          // 角度命令を速度0で始めるとFWにより即時完了するため、動く側は最低1%。
          const zero=jump(OP.JR_LT32,[weights[i],c(1)]);clamp(value,1,100);patch(zero,code.length);
        }
        emit(OP.MUL32,value,direction(ports[i]),value);
      };
      // Reject disconnected/wrong devices before starting either shaft.
      ports.forEach(port=>integerExpr({sensor:{kind:'encoder',port:port+1}}));
      if(timed){
        const total=reg();emit(OP.ADD32,up,down,total);
        const enoughTime=jump(OP.JR_LT32,[total,target]);
        // Compressed moves lower the peak speed, preserving ramp slopes.
        emit(OP.MUL32,base,target,base);emit(OP.DIV32,base,total,base);clamp(base,1,100);
        emit(OP.MUL32,up,target,up);emit(OP.DIV32,up,total,up);emit(OP.SUB32,target,up,down);
        patch(enoughTime,code.length);
      }else{
        emit(OP.MUL32,target,c(500),limit);emit(OP.DIV32,limit,base,limit);emit(OP.ADD32,limit,c(5000),limit);emit(OP.ADD32,limit,up,limit);emit(OP.ADD32,limit,down,limit);guard(limit,1,180000);
      }
      const start=ports.map(reg),current=ports.map(reg),progress=ports.map(reg),busy=ports.map(reg),speed=ports.map(reg);
      const common=reg(),remaining=reg(),sum=reg(),previous=reg(),previousTime=reg(),sampleDt=reg(),braking=reg(),delta=reg(),phase=reg(),decelStart=reg(),decelDuration=reg(),decelBase=reg();
      if(!timed){emit(OP.MOTOR_RESET,c(0),c(b.ports));ports.forEach((port,i)=>emit(OP.MOTOR_COUNT,c(0),c(port),start[i]));for(const value of [previous,previousTime,braking,phase])emit(OP.MOVE32,c(0),value);}
      emit(OP.MOVE32,base,cap);const noRamp=jump(OP.JR_LT32,[up,c(1)]);emit(OP.MOVE32,c(1),cap);patch(noRamp,code.length);
      emit(OP.TIMER_READ,began);
      if(timed){
        if(weighted){const active=reg();emit(OP.MOVE32,c(0),active);ports.forEach((port,i)=>{emit(OP.MOVE32,cap,speed[i]);signedSpeed(i,speed[i]);const moving=jump(OP.JR_GT32,[weights[i],c(0)]);emit(OP.STOP,c(0),c(1<<port),c(1));const done=jump(OP.JR,[]);patch(moving,code.length);emit(OP.MOTOR_SPEED,c(0),c(1<<port),speed[i]);emit(OP.ADD32,active,c(1<<port),active);patch(done,code.length);});emit(OP.MOTOR_START,c(0),active);}
        else{emit(OP.MUL32,cap,sign,speed[0]);emit(OP.MOTOR_SPEED,c(0),c(b.ports),speed[0]);emit(OP.MOTOR_START,c(0),c(b.ports));}
      }else ports.forEach((port,i)=>{
        emit(OP.MOVE32,cap,speed[i]);signedSpeed(i,speed[i]);
        let inactive,done;if(weighted){inactive=jump(OP.JR_LT32,[targets[i],c(1)]);}
        emit(OP.MOTOR,c(0),c(1<<port),speed[i],c(0),portTarget(i),c(0),motors.nativeBrake(1<<port));
        if(weighted){done=jump(OP.JR,[]);patch(inactive,code.length);emit(OP.STOP,c(0),c(1<<port),c(1));patch(done,code.length);}
      });
      const loop=code.length;
      emit(OP.TIMER_READ,elapsed);emit(OP.SUB32,elapsed,began,elapsed);
      if(timed){finishes.push(jump(OP.JR_GT32,[elapsed,target]));const equal=reg();emit(OP.SUB32,target,elapsed,equal);finishes.push(jump(OP.JR_LT32,[equal,c(1)]));}
      else{
        emit(OP.MOVE32,c(0),sum);
        ports.forEach((port,i)=>{emit(OP.MOTOR_TEST,c(0),c(1<<port),busy[i]);emit(OP.ADD32,sum,busy[i],sum);emit(OP.MOTOR_COUNT,c(0),c(port),current[i]);emit(OP.SUB32,current[i],start[i],progress[i]);emit(OP.MUL32,progress[i],direction(port),progress[i]);});
        finishes.push(jump(OP.JR_LT32,[sum,c(1)]));faults.push(jump(OP.JR_GT32,[elapsed,limit]));
        if(weighted){
          // 外側（速い側）の角度へ換算して進み具合を比較する。停止側は最小値に含めない。
          emit(OP.MOVE32,target,common);
          ports.forEach((port,i)=>{const inactive=jump(OP.JR_LT32,[targets[i],c(1)]);emit(OP.MUL32,progress[i],ratioBase,progress[i]);emit(OP.DIV32,progress[i],weights[i],progress[i]);const smaller=jump(OP.JR_LT32,[common,progress[i]]);emit(OP.MOVE32,progress[i],common);patch(smaller,code.length);patch(inactive,code.length);});
        }else{emit(OP.MOVE32,progress[0],common);if(ports.length===2){const smaller=jump(OP.JR_LT32,[common,progress[1]]);emit(OP.MOVE32,progress[1],common);patch(smaller,code.length);}}
        emit(OP.SUB32,target,common,remaining);
        // Estimate stopping distance from measured progress, without assuming
        // a particular L/M motor's degrees-per-second conversion or gearing.
        emit(OP.SUB32,elapsed,previousTime,sampleDt);const notSample=jump(OP.JR_LT32,[sampleDt,c(100)]);
        emit(OP.SUB32,common,previous,delta);const forward=jump(OP.JR_GT32,[delta,c(-1)]);emit(OP.MOVE32,c(0),delta);patch(forward,code.length);
        emit(OP.MUL32,delta,down,braking);emit(OP.DIV32,braking,sampleDt,braking);emit(OP.DIV32,braking,c(2),braking);
        emit(OP.MOVE32,common,previous);emit(OP.MOVE32,elapsed,previousTime);patch(notSample,code.length);
      }
      emit(OP.MOVE32,base,cap);
      const instantUp=jump(OP.JR_LT32,[up,c(1)]),upDone=jump(OP.JR_GT32,[elapsed,up]);
      const upCurve=curve(elapsed,up);emit(OP.MUL32,base,upCurve,cap);emit(OP.DIV32,cap,c(1000),cap);
      patch(instantUp,code.length);patch(upDone,code.length);clamp(cap,1,100);
      if(timed){
        emit(OP.SUB32,target,elapsed,remaining);
        const instantDown=jump(OP.JR_LT32,[down,c(1)]),notYet=jump(OP.JR_GT32,[remaining,down]);
        const downCurve=curve(remaining,down),downCap=reg();emit(OP.MUL32,base,downCurve,downCap);emit(OP.DIV32,downCap,c(1000),downCap);
        const alreadyLower=jump(OP.JR_LT32,[cap,downCap]);emit(OP.MOVE32,downCap,cap);patch(alreadyLower,code.length);patch(instantDown,code.length);patch(notYet,code.length);clamp(cap,1,100);
        if(weighted)ports.forEach((port,i)=>{const zero=jump(OP.JR_LT32,[weights[i],c(1)]);emit(OP.MOVE32,cap,speed[i]);signedSpeed(i,speed[i]);emit(OP.MOTOR_SPEED,c(0),c(1<<port),speed[i]);patch(zero,code.length);});
        else{emit(OP.MUL32,cap,sign,speed[0]);emit(OP.MOTOR_SPEED,c(0),c(b.ports),speed[0]);}
      }else{
        const instantDown=jump(OP.JR_LT32,[down,c(1)]);
        const alreadyDecelerating=jump(OP.JR_GT32,[phase,c(0)]),notYet=jump(OP.JR_GT32,[remaining,braking]);
        emit(OP.MOVE32,c(1),phase);emit(OP.MOVE32,elapsed,decelStart);emit(OP.MOVE32,cap,decelBase);
        emit(OP.MUL32,down,cap,decelDuration);emit(OP.DIV32,decelDuration,base,decelDuration);clamp(decelDuration,20,10000);
        patch(alreadyDecelerating,code.length);
        const timeLeft=reg();emit(OP.SUB32,elapsed,decelStart,timeLeft);emit(OP.SUB32,decelDuration,timeLeft,timeLeft);
        const downCurve=curve(timeLeft,decelDuration);emit(OP.MUL32,decelBase,downCurve,cap);emit(OP.DIV32,cap,c(1000),cap);clamp(cap,1,100);
        patch(notYet,code.length);patch(instantDown,code.length);
        ports.forEach((port,i)=>{
          emit(OP.MOVE32,cap,speed[i]);
          if(ports.length===2){const diff=reg();emit(OP.SUB32,progress[i],weighted?common:progress[1-i],diff);const notAhead=jump(OP.JR_LT32,[diff,c(1)]);emit(OP.MUL32,diff,c(2),diff);emit(OP.SUB32,speed[i],diff,speed[i]);clamp(speed[i],0,100);patch(notAhead,code.length);}
          // 進み過ぎた側を一時的に0にする補正は保持し、それ以外は比率に換算する。
          const paused=jump(OP.JR_LT32,[speed[i],c(1)]);signedSpeed(i,speed[i]);patch(paused,code.length);
          const finished=jump(OP.JR_LT32,[busy[i],c(1)]);emit(OP.MOTOR_SPEED,c(0),c(1<<port),speed[i]);patch(finished,code.length);
        });
      }
      emit(OP.WAIT,c(20),local(timer));emit(OP.READY,local(timer));const again=jump(OP.JR,[]);patch(again,loop);
      for(const at of finishes)patch(at,code.length);
      motors.stop(b.ports);
    };

    // ステアリング／左右別速度を同じ加減速エンジンへ渡す。入力式は呼び出し側で1回だけ評価する。
    const rampedPair=(b,leftSpeed,rightSpeed)=>{
      const absolute=value=>{const out=local(alloc());emit(OP.MOVE32,value,out);const positive=jump(OP.JR_GT32,[out,constant(-1)]);emit(OP.SUB32,constant(0),out,out);patch(positive,code.length);return out;};
      const a=absolute(expr(leftSpeed)),d=absolute(expr(rightSpeed)),peakAt=alloc(),peak=local(peakAt);emit(OP.MOVE32,a,peak);const larger=jump(OP.JR_GT32,[a,d]);emit(OP.MOVE32,d,peak);patch(larger,code.length);nonzero(peak);
      rampedMotion({type:b.action==='time'?'motorTimed':'motor',ports:b.leftPort|b.rightPort,speed:{register:peakAt},portSpeeds:{[Math.log2(b.leftPort)]:leftSpeed,[Math.log2(b.rightPort)]:rightSpeed},...(b.action==='time'?{seconds:b.seconds,secondsAreMs:b.secondsAreMs}:{degrees:b.degrees})});
    };

    // 制御構造をEV3の比較・ジャンプ・呼び出し命令へ展開する。終了命令の後の同じ並びは生成しない。
    const sequence=nodes=>{
      const previousValues=returnedValues;try{
      for(const original of nodes) {
        returnedValues=new WeakMap();
        let b=original;
        if(b.type==='movement'){
          // 配線の読み取りだけを排他化。有限走行の完了待ちで計測処理を妨げない。
          const selected=local(alloc());locked(()=>emit(OP.MOVE32,globalVar(movementOffset),selected));
          const ends=[];let localPeak=bytes;
          for(const variant of b.variants){
            const different=local(alloc());emit(OP.SUB32,selected,constant(variant.id),different);
            const low=jump(OP.JR_LT32,[different,constant(0)]),high=jump(OP.JR_GT32,[different,constant(0)]);
            const startBytes=bytes;sequence(variant.body);const peakBytes=bytes;
            ends.push(jump(OP.JR,[]));patch(low,code.length);patch(high,code.length);
            // 分岐は同時に動かないため、次の分岐と作業領域を共有する。
            localPeak=Math.max(localPeak,peakBytes);bytes=startBytes;
          }
          movementFaults.push(jump(OP.JR,[]));for(const end of ends)patch(end,code.length);
          bytes=Math.max(bytes,localPeak);continue;
        }
        if(b.type==='movementSetup'){
          locked(()=>{
            const current=globalVar(movementOffset),id=movementId(b.leftPort,b.rightPort),difference=local(alloc());
            emit(OP.SUB32,current,constant(id),difference);
            const low=jump(OP.JR_LT32,[difference,constant(0)]),high=jump(OP.JR_GT32,[difference,constant(0)]),same=jump(OP.JR,[]);
            patch(low,code.length);patch(high,code.length);
            // 旧組を停止してから切り替える。同じ左右設定の再実行は停止しない。
            const empty=jump(OP.JR_LT32,[current,constant(1)]),left=local(alloc()),right=local(alloc()),mask=local(alloc());
            emit(OP.DIV32,current,constant(16),left);emit(OP.MUL32,left,constant(16),right);emit(OP.SUB32,current,right,right);emit(OP.ADD32,left,right,mask);
            emit(OP.STOP,constant(0),mask,constant(1));patch(empty,code.length);
            emit(OP.MOVE32,constant(id),current);patch(same,code.length);
          });continue;
        }
        const shared=['displayClear','displayBitmap','displayNumber','set','change','textSet','listAdd','listSet','listClear','listDelete','logStart','logValue','logEnd','broadcast','wheel','tread','ramp','timerReset','stopMode','pidReset'].includes(b.type)&&lock&&!lockDepth;
        if(shared){lock.acquire();lockDepth++;}
        if(usesSensors||usesForever||usesFloat||usesRamps){
          const checked=(source,min,max)=>{const at=alloc();emit(OP.MOVE32,expr(source),local(at));guard(local(at),min,max);return {register:at};};
          if(b.driveSource){const cm=checked(b.driveSource.cm,1,1000),speed=checked(b.driveSource.speed,-100,100);b={...b,speed:scaled(speed,b.driveSource.direction==='backward'?-1:1),degrees:{geometry:{kind:'distance',value:cm}}};}
          if(b.pivotSource){const angle=checked(b.pivotSource.angle,1,3600),speed=checked(b.pivotSource.speed,-100,100);b={...b,speed,degrees:{geometry:{kind:'pivot',value:angle}}};}
          if(b.spinSource){const angle=checked(b.spinSource.angle,1,3600),speed=checked(b.spinSource.speed,-100,100);b={...b,speed,degrees:{geometry:{kind:'spin',value:angle}}};}
          const fields={motorRun:{speed:[-100,100]},motor:{speed:[-100,100],degrees:[1,36000]},motorTimed:{speed:[-100,100],seconds:[1,60000]},tone:{frequency:[250,10000],ms:[1,30000]},wait:{ms:[0,60000]},repeat:{count:[0,1000]}}[b.type];
          if(fields){b={...b};for(const [name,range]of Object.entries(fields)){const at=alloc();let source=b[name];if(b.type==='motorTimed'&&name==='seconds')source=scaled(source,1000);emit(OP.MOVE32,expr(source),local(at));guard(local(at),...range);b[name]={register:at};}
            if(b.type==='motor'||b.type==='motorTimed')nonzero(expr(b.speed));
            if(b.type==='motorTimed')b.secondsAreMs=true;
          }
        }
        switch(b.type) {
          case 'displayClear':case 'displayBitmap':case 'displayNumber':emitDisplay(b,{emit,constant,floatExpr,guard,floatGuard});break;
          case 'led':emit(0x82,constant(27),constant(b.color===0?0:b.color+({on:0,flash:3,pulse:6}[b.mode])));break;
          case 'steering':{
            const ports=b.leftPort|b.rightPort,speed=expr(b.speed),turn=expr(b.turn),nativeTurn=local(alloc());guard(speed,-100,100);guard(turn,-100,100);
            emit(OP.MUL32,turn,constant(b.leftPort<b.rightPort?2:-2),nativeTurn);
            if(b.action==='run'){emit(OP.MOTOR_SYNC,constant(0),constant(ports),speed,nativeTurn,constant(0),constant(0));}
            else{
              nonzero(speed);let legacy,done,amount;
              if(usesRamps){
                // 分岐前に量も評価する。式中のマイブロックを片方の分岐だけへ生成しない。
                const amountAt=alloc();amount=local(amountAt);emit(OP.MOVE32,b.action==='angle'?expr(b.degrees):expr(scaled(b.seconds,1000)),amount);guard(amount,1,b.action==='angle'?36000:60000);
                const paired={...b,...(b.action==='angle'?{degrees:{register:amountAt}}:{seconds:{register:amountAt},secondsAreMs:true})};
                legacy=jump(OP.JR_LT32,[globalVar(rampOffset),constant(1)]);
                const leftAt=alloc(),rightAt=alloc(),factor=local(alloc()),left=local(leftAt),right=local(rightAt);
                emit(OP.MOVE32,speed,left);emit(OP.MOVE32,speed,right);
                const negative=jump(OP.JR_LT32,[turn,constant(0)]);
                emit(OP.MUL32,turn,constant(2),factor);emit(OP.SUB32,constant(100),factor,factor);emit(OP.MUL32,speed,factor,right);emit(OP.DIV32,right,constant(100),right);const ready=jump(OP.JR,[]);
                patch(negative,code.length);emit(OP.MUL32,turn,constant(2),factor);emit(OP.ADD32,constant(100),factor,factor);emit(OP.MUL32,speed,factor,left);emit(OP.DIV32,left,constant(100),left);patch(ready,code.length);
                rampedPair(paired,{register:leftAt},{register:rightAt});done=jump(OP.JR,[]);patch(legacy,code.length);
              }
              const brake=motors.nativeBrake(ports,true);emit(OP.MOTOR_RESET,constant(0),constant(ports));if(!amount)amount=b.action==='angle'?expr(b.degrees):expr(scaled(b.seconds,1000));guard(amount,1,b.action==='angle'?36000:60000);
              emit(b.action==='time'?0xb1:OP.MOTOR_SYNC,constant(0),constant(ports),speed,nativeTurn,amount,brake);emit(OP.MOTOR_READY,constant(0),constant(ports));motors.finish(ports);if(done!==undefined)patch(done,code.length);
            }break;
          }
          case 'stopMode':motors.configure(b);break;
          case 'tankFinite':{
            let done;
            if(usesRamps){
              const leftAt=alloc(),rightAt=alloc(),amountAt=alloc();emit(OP.MOVE32,expr(b.leftSpeed),local(leftAt));guard(local(leftAt),-100,100);emit(OP.MOVE32,expr(b.rightSpeed),local(rightAt));guard(local(rightAt),-100,100);
              emit(OP.MOVE32,b.action==='angle'?expr(b.degrees):expr(scaled(b.seconds,1000)),local(amountAt));guard(local(amountAt),1,b.action==='angle'?36000:60000);
              b={...b,leftSpeed:{register:leftAt},rightSpeed:{register:rightAt},...(b.action==='angle'?{degrees:{register:amountAt}}:{seconds:{register:amountAt},secondsAreMs:true})};
              const legacy=jump(OP.JR_LT32,[globalVar(rampOffset),constant(1)]);rampedPair(b,b.leftSpeed,b.rightSpeed);done=jump(OP.JR,[]);patch(legacy,code.length);
            }
            motors.tank(b);if(done!==undefined)patch(done,code.length);break;
          }
          case 'motorPower':case 'motorSpeedSet':{const speed=expr(b.speed);guard(speed,-100,100);emit(b.type==='motorPower'?OP.MOTOR_POWER:OP.MOTOR_SPEED,constant(0),constant(b.ports),speed);if(b.type==='motorPower')emit(OP.MOTOR_START,constant(0),constant(b.ports));break;}
          case 'textSet':case 'listAdd':case 'listSet':case 'listClear':case 'listDelete':case 'logStart':case 'logValue':case 'logEnd':dataOps.statement(b);break;
          case 'ramp':{emit(OP.MOVE32,constant({off:0,trapezoid:1,scurve:2}[b.mode]),globalVar(rampOffset));for(const [i,name]of ['upSeconds','downSeconds'].entries()){const time=expr(scaled(b[name],1000));guard(time,0,10000);emit(OP.MOVE32,time,globalVar(rampOffset+4+i*4));}break;}
          case 'wheel':emit(OP.MOVE32,constant(Math.round(b.diameter*10)),globalVar(diameterOffset));break;
          case 'tread':emit(OP.MOVE32,constant(Math.round(b.mm*10)),globalVar(treadOffset));break;
          case 'set':emit(usesFloat?0x3f:OP.MOVE32,usesFloat?floatExpr(b.value):expr(b.value),globalVar(globalOffsets.get(b.var)));break;
          case 'change':{const target=globalVar(globalOffsets.get(b.var));emit(usesFloat?0x13:OP.ADD32,target,usesFloat?floatExpr(b.value):expr(b.value),target);if(usesFloat)floatGuard(target);break;}
          case 'if':{const skip=jump(OP.JR_LT32,[expr(b.condition),constant(1)]);sequence(b.then);const end=jump(OP.JR,[]);patch(skip,code.length);sequence(b.else);patch(end,code.length);break;}
          case 'forever':{const start=code.length;sequence(b.body);emit(OP.WAIT,constant(20),local(timer));emit(OP.READY,local(timer));const again=jump(OP.JR,[]);patch(again,start);break;}
          case 'while':{const start=code.length,condition=expr(b.condition),out=jump(b.until?OP.JR_GT32:OP.JR_LT32,[condition,constant(b.until?0:1)]);sequence(b.body);if(usesSensors||parallel){emit(OP.WAIT,constant(20),local(timer));emit(OP.READY,local(timer));}const again=jump(OP.JR,[]);patch(again,start);patch(out,code.length);break;}
          case 'tank':{
            const active=local(alloc()),left=local(alloc()),right=local(alloc());
            // Sample and validate both inputs before changing either motor.
            emit(OP.MOVE32,expr(b.leftSpeed),left);guard(left,-100,100);
            emit(OP.MOVE32,expr(b.rightSpeed),right);guard(right,-100,100);
            emit(OP.MOVE32,constant(0),active);
            for(const [port,speed]of [[b.leftPort,left],[b.rightPort,right]]){
              const nonzeroSpeed=exprCompare(speed,constant(0)),run=jump(OP.JR_GT32,[nonzeroSpeed,constant(0)]);
              motors.stop(port);const done=jump(OP.JR,[]);
              patch(run,code.length);emit(OP.MOTOR_SPEED,constant(0),constant(port),speed);emit(OP.ADD32,active,constant(port),active);patch(done,code.length);
            }
            const allStopped=jump(OP.JR_LT32,[active,constant(1)]);
            // One start for the two prepared speeds; preserve other outputs.
            emit(OP.MOTOR_START,constant(0),active);patch(allStopped,code.length);break;
          }
          case 'motorRun':{
            const speed=expr(b.speed),zero=local(alloc());emit(OP.MOVE32,constant(0),zero);emit(0x4e,speed,constant(0),zero);
            const run=jump(OP.JR_LT32,[zero,constant(1)]);motors.stop(b.ports);const done=jump(OP.JR,[]);
            patch(run,code.length);emit(OP.MOTOR_SPEED,constant(0),constant(b.ports),speed);emit(OP.MOTOR_START,constant(0),constant(b.ports));patch(done,code.length);break;
          }
          case 'motorTimed':{let legacy,done;if(usesRamps){legacy=jump(OP.JR_LT32,[globalVar(rampOffset),constant(1)]);rampedMotion(b);done=jump(OP.JR,[]);patch(legacy,code.length);}motors.finite(OP.MOTOR_TIME,b.ports,expr(b.speed),expr(b.secondsAreMs?b.seconds:scaled(b.seconds,1000)));emit(OP.MOTOR_READY,constant(0),constant(b.ports));motors.finish(b.ports);if(done!==undefined)patch(done,code.length);break;}
          case 'motor':{
            let legacy,done;if(usesRamps){legacy=jump(OP.JR_LT32,[globalVar(rampOffset),constant(1)]);rampedMotion(b);done=jump(OP.JR,[]);patch(legacy,code.length);}
            if((b.ports & (b.ports-1))!==0 && b.mode==='feedback'){
              feedbackPair(b);
            }else if((b.ports & (b.ports-1))!==0 && b.mode==='sync'){
              // Exactly two ports: EV3 regulates the pair together. TURN=0
              // requests equal rotation rather than independent speed control.
              // The driver compares accumulated TachoCnt values, so unequal
              // old counts must not become part of a fresh relative movement.
              emit(OP.MOTOR_RESET,constant(0),constant(b.ports));
              emit(OP.MOTOR_SYNC,constant(0),constant(b.ports),expr(b.speed),constant(0),expr(b.degrees),motors.nativeBrake(b.ports,true));
            }else{
              motors.finite(OP.MOTOR,b.ports,expr(b.speed),expr(b.degrees));
            }
            emit(OP.MOTOR_READY,constant(0),constant(b.ports));motors.finish(b.ports);if(done!==undefined)patch(done,code.length);break;}
          case 'tone': emit(OP.SOUND,constant(1),constant(b.volume),expr(b.frequency),expr(b.ms)); emit(OP.SOUND_READY); break;
          case 'wait': emit(OP.WAIT,expr(b.ms),local(timer)); emit(OP.READY,local(timer)); break;
          case 'pidReset':pidOps.reset(b.name);break;
          case 'timerReset':emit(OP.TIMER_READ,globalVar(timerOffset));break;
          case 'gyroReset':{const raw=integerExpr({sensor:{kind:'gyroAngle',port:b.port}},{rawGyro:true});emit(OP.MOVE32,raw,globalVar(gyroOffset+4*(b.port-1)));break;}
          case 'encoderReset':integerExpr({sensor:{kind:'encoder',port:b.port}});emit(OP.MOTOR_CLEAR_COUNT,constant(0),constant(1<<(b.port-1)));break;
          case 'programEnd':emit(OP.STOP,constant(0),constant(15),constant(1));emit(OP.PROGRAM_STOP,constant(-1));return;
          case 'returnValue':returnResults([b.value]);return;
          case 'returnValues':returnResults(b.values);return;
          case 'myblockReturn':if(!p.subcall)throw Error('マイブロックの終了は定義の中だけで使えます。');emit(OP.RETURN);return;
          case 'stop': motors.stop(b.ports??15,b.stopMode); break;
          case 'broadcast':{
            if(!parallel)break;
            const counter=messageAt(b.message),sent=local(alloc());guard(counter,0,2147483645);
            emit(OP.ADD32,counter,constant(1),counter);emit(OP.MOVE32,counter,sent);
            // 送信だけを共有領域の排他対象にする。待機中は受信側が記録・変数更新できる。
            if(shared){lockDepth--;lock.release();}
            if(b.wait)for(let i=0;i<roots.length;i++)if(roots[i].kind==='message'&&roots[i].message===b.message){
              const check=code.length,pending=jump(OP.JR_LT32,[ackAt(i),sent]),done=jump(OP.JR,[]);
              patch(pending,code.length);emit(OP.WAIT,constant(5),local(timer));emit(OP.READY,local(timer));const again=jump(OP.JR,[]);patch(again,check);patch(done,code.length);
            }
            break;
          }
          case 'callOutputs':{const results=callResults(b);locked(()=>results.forEach((value,i)=>emit(0x3f,value,globalVar(globalOffsets.get(b.targets[i])))));break;}
          case 'call': {const id=ids.get(b.name); if(!id)throw Error(`「${b.name}」の定義がありません。`); emit(OP.CALL,constant(id),constant(b.args.length),...b.args.map(usesFloat?floatExpr:expr)); break;}
          case 'repeat': {
            const counter=alloc(); emit(OP.MOVE32,expr(b.count),local(counter));
            const start=code.length; const out=jump(OP.JR_LT32,[local(counter),constant(1)]);
            sequence(b.body); emit(OP.SUB32,local(counter),constant(1),local(counter));
            const back=jump(OP.JR,[]);patch(back,start);patch(out,code.length);break;
          }
          default: throw Error(`未対応のブロック: ${b.type}`);
        }
        if(shared&&b.type!=='broadcast'){lockDepth--;lock.release();}
      }
      }finally{returnedValues=previousValues;}
    };
    // 実行開始時だけ共有領域を初期化する。マイブロックから戻るたびに通常変数を消してはいけない。
    if(index===0){for(const at of globalOffsets.values())emit(OP.MOVE32,constant(0),globalVar(at));if(usesGeometry)for(const at of [diameterOffset,treadOffset])emit(OP.MOVE32,constant(0),globalVar(at));}
    if(index===0&&usesRamps)for(const at of [rampOffset,rampOffset+4,rampOffset+8])emit(OP.MOVE32,constant(0),globalVar(at));
    if(index===0&&usesTimer)emit(OP.MOVE32,constant(0),globalVar(timerOffset));
    if(index===0&&usesStopModes)for(let i=0;i<4;i++)emit(OP.MOVE32,constant(0),globalVar(stopModeOffset+4*i));
    if(index===0&&usesGyro)for(let i=0;i<4;i++)emit(OP.MOVE32,constant(0),globalVar(gyroOffset+4*i));
    if(index===0&&usesMovement)emit(OP.MOVE32,constant(0),globalVar(movementOffset));
    if(index===0){pidOps.init();dataOps.init();}
    const pause=ms=>{emit(OP.WAIT,constant(ms),local(timer));emit(OP.READY,local(timer));};
    if(p.boot){
      for(let at=messageBase;at<globalBytes;at+=4)emit(OP.MOVE32,constant(0),globalVar(at));
      for(let i=0;i<roots.length;i++)emit(OP.OBJECT_START,constant(i+2));
      for(let i=0;i<roots.length;i++)if(roots[i].kind==='start')emit(OP.OBJECT_WAIT,constant(i+2));
      if(roots.some(r=>r.kind!=='start')){const top=code.length;pause(20);const again=jump(OP.JR,[]);patch(again,top);}
      else emit(OP.STOP,constant(0),constant(15),constant(1));
    }else if(parallel&&!p.subcall&&p.kind!=='start'){
      const previous=local(alloc());
      if(p.kind==='message')emit(OP.MOVE32,constant(0),previous);
      else if(p.kind==='changed')emit(0x3f,floatExpr(p.condition),previous);
      else emit(OP.MOVE32,constant(0),previous);
      const top=code.length;
      let idle,observed;
      if(p.kind==='message'){
        observed=local(alloc());emit(OP.MOVE32,messageAt(p.message),observed);
        const equal=local(alloc());emit(OP.SUB32,observed,previous,equal);faults.push(jump(OP.JR_LT32,[equal,constant(0)]));idle=jump(OP.JR_LT32,[equal,constant(1)]);
        sequence(p.body);emit(OP.MOVE32,observed,previous);emit(OP.MOVE32,observed,ackAt(p.root));
      }else if(p.kind==='condition'){
        const now=expr(p.condition),was=local(alloc());emit(OP.MOVE32,previous,was);emit(OP.MOVE32,now,previous);
        const no=jump(OP.JR_LT32,[now,constant(1)]);idle=jump(OP.JR_GT32,[was,constant(0)]);sequence(p.body);patch(no,code.length);
      }else{
        const now=floatExpr(p.condition),changed=local(alloc());emit(OP.MOVE32,constant(0),changed);emit(0x53,now,previous,changed);emit(0x3f,now,previous);idle=jump(OP.JR_LT32,[changed,constant(1)]);sequence(p.body);
      }
      patch(idle,code.length);pause(20);const again=jump(OP.JR,[]);patch(again,top);
    }else{
      sequence(p.body);
      if(p.subcall){if(p.returns)returnResults(procedureResults(p));else emit(OP.RETURN);}else if(!parallel)emit(OP.STOP,constant(0),constant(15),constant(1));
    }
    // Firmware validation scans each object sequentially up to its first END.
    // Keep fault handlers inside that object, and skip them on normal completion.
    if(movementFaults.length){
      const normalEnd=jump(OP.JR,[]);for(const at of movementFaults)patch(at,code.length);
      // 明示的な未設定エラー。エラー番号23と×を本体へ表示し、すべて停止する。
      emit(OP.STOP,constant(0),constant(15),constant(1));
      emitDisplay({type:'displayClear'},{emit,constant,floatExpr,guard,floatGuard});
      emitDisplay({type:'displayBitmap',x:0,y:0,bitmap:presetBitmap('cross',48)},{emit,constant,floatExpr,guard,floatGuard});
      emitDisplay({type:'displayNumber',x:56,y:12,font:2,decimals:0,value:23},{emit,constant,floatExpr,guard,floatGuard});
      emit(OP.SOUND,constant(1),constant(25),constant(300),constant(400));emit(OP.SOUND_READY);emit(OP.PROGRAM_STOP,constant(-1));patch(normalEnd,code.length);
    }
    if(faults.length){const normalEnd=jump(OP.JR,[]);for(const at of faults)patch(at,code.length);emit(OP.STOP,constant(0),constant(15),constant(1));emit(OP.SOUND,constant(1),constant(25),constant(300),constant(400));emit(OP.SOUND_READY);emit(OP.PROGRAM_STOP,constant(-1));patch(normalEnd,code.length);}
    emit(OP.END);
    return {code,localBytes:bytes,trigger:p.subcall?1:0,name:p.name,kind:p.subcall?'procedure':p.boot?'boot':p.kind??'start'};
  });
  // RBFは16バイトのファイルヘッダ、各12バイトのオブジェクトヘッダ、命令列の順。
  // オブジェクト末尾とジャンプ位置は、実機VMの検証を通すため正確に一致させる。
  let offset=16+12*objects.length;
  const headers=[];
  for(const o of objects) {o.offset=offset; headers.push(...u32(offset),...u16(0),...u16(o.trigger),...u32(o.localBytes)); offset+=o.code.length;}
  if(offset>65536)throw Error('プログラムが大きすぎます（上限64KB）。');
  const data=new Uint8Array([76,69,71,79,...u32(offset),...u16(104),...u16(objects.length),...u32(globalBytes),...headers,...objects.flatMap(o=>o.code)]);
  return {data,objects,program,usesParallel:!!parallel,threadCount:parallel?roots.length:1,logFiles:extras.files,usesSensors,usesFloat,usesRamps,usesTimer,diagnosticTag,diagnosticPath:recordsTiming&&!usesRamps?diagnosticPath:null};
}

// 本体に保存した68バイトの補正記録を復号する。識別タグを照合し、別のプログラムの古い記録を混同しない。
export function decodeTimingRecord(data,expectedTag){
  if(data.length!==68)throw Error('停止時刻の記録形式が一致しません。0.1.6以降で再転送・実行してください。');
  const v=new DataView(data.buffer,data.byteOffset,data.byteLength),word=i=>v.getInt32(i*4,true);
  if(v.getUint32(0,true)!==0x314d4954 || word(1)!==expectedTag)throw Error('現在のプログラムと記録が一致しません。再転送したファイルを実行してください。');
  const ports=[0,1,2,3].filter(i=>word(2)&(1<<i));
  if(ports.length!==2 || word(2)<1 || word(2)>15 || ![0,1].includes(word(16)))throw Error('停止時刻の記録が不正です。');
  const stopMs=[word(6),word(7)];
  if(stopMs.some(n=>n < -1 || n>180100))throw Error('停止時刻の値が不正です。');
  return {tag:word(1),ports:ports.map(i=>String.fromCharCode(65+i)),speed:word(3),targetDegrees:word(4),startedAtMs:word(5)>>>0,
    stopMs,deltaMs:stopMs.every(n=>n>=0)?stopMs[1]-stopMs[0]:null,degrees:[word(8),word(9)],
    checkpoints:[25,50,75].map((percent,i)=>({percent,ms:[word(10+2*i),word(11+2*i)]})),timedOut:word(16)===1};
}

// EV3パケットは長さ2バイト・通番2バイト・種別1バイト・内容の順。長さは先頭2バイト自身を含まない。
export function packet(counter,type,payload) {return new Uint8Array([...u16(3+payload.length),...u16(counter),type,...payload]);}
// Bluetoothの受信はパケット単位とは限らない。分割・結合されたバイト列を長さ情報から組み直す。
export class Framer {
  constructor(onPacket){this.buffer=new Uint8Array();this.onPacket=onPacket;}
  push(chunk){
    this.buffer=new Uint8Array([...this.buffer,...chunk]);
    while(this.buffer.length>=2){
      const n=this.buffer[0]+256*this.buffer[1];
      if(n<3 || n>4096)throw Error('EV3応答の長さが不正です。接続先を確認してください。');
      if(this.buffer.length<n+2)return;
      const frame=this.buffer.slice(0,n+2);this.buffer=this.buffer.slice(n+2);this.onPacket(frame);
    }
  }
}
const statusNames={1:'ファイルハンドルが無効',2:'本体の準備ができていません',3:'ファイルが破損',4:'ファイルを開けません',5:'書き込みが許可されていません',6:'保存先が不正',7:'すでに存在します',8:'ファイル末尾',9:'サイズが不正',10:'本体側のエラー',11:'ファイル名が不正',12:'接続が無効'};
// Stock EV3: vendor-defined HID, no report ID; 1024-byte high-speed or
// 64-byte full-speed reports (LEGO d_usbdev/computil.c descriptors).
const EV3_USB_FILTER={vendorId:0x0694,productId:0x0005,usagePage:0xff00,usage:1};
// USBは標準EV3のHIDレポートを確認する。ブートローダー用のデバイスや想定外の形式は使わない。
function ev3HidReports(device){
 if(device.vendorId!==EV3_USB_FILTER.vendorId||device.productId!==EV3_USB_FILTER.productId)throw Error('標準ファームウェアで起動したEV3を選んでください。');
 const collections=[];const walk=items=>{for(const c of items??[]){if(c.usagePage===0xff00&&c.usage===1)collections.push(c);walk(c.children);}};walk(device.collections);
 const size=(collection,key)=>{const report=collection[key]?.find(r=>r.reportId===0);if(!report)return 0;const bits=(report.items??[]).reduce((n,item)=>n+item.reportSize*item.reportCount,0);return bits/8;};
 for(const c of collections){const inputSize=size(c,'inputReports'),outputSize=size(c,'outputReports');if([64,1024].includes(inputSize)&&[64,1024].includes(outputSize))return {inputSize,outputSize,reportId:0};}
 throw Error('EV3のUSB通信形式を確認できません。標準ファームウェアで起動し、USBケーブルを接続し直してください。');
}
// 共通の送受信・照合処理に、BluetoothのストリームとUSBのHIDレポートを接続する。
// platformを差し替えられる形にして、実機がない環境でも通信の試験を行えるようにする。
export class EV3Connection {
  constructor(log=()=>{},changed=()=>{},platform=globalThis){this.log=log;this.changed=changed;this.platform=platform;this.counter=0;this.pending=new Map();this.port=null;this.device=null;this.transport='bluetooth';this.closing=false;}
  get connected(){return !!(this.port||this.device) && !this.closing;}
  get chunkSize(){return this.transport==='usb'&&this.usbReports?Math.min(240,this.usbReports.outputSize-7,this.usbReports.inputSize-12):240;}
  // BluetoothはOSでペアリング済みのシリアルポートを、ユーザー操作で選択して開く。
  async connect(transport='bluetooth'){
    if(this.port||this.device)throw Error('接続中です。先に切断してください。');
    if(!['bluetooth','usb'].includes(transport))throw Error('接続方式を選んでください。');
    if(!this.platform.isSecureContext)throw Error('HTTPSのページ、またはlocalhostで開いてください。');
    if(transport==='usb')return this.connectUSB();
    const serial=this.platform.navigator?.serial;
    if(!serial)throw Error('このブラウザではBluetooth接続を使えません。Chromeで開いてください。');
    // SPP (0x1101) ports are included by default, including unmapped ChromeOS RFCOMM ports.
    const port=await serial.requestPort();
    try {await port.open({baudRate:115200,bufferSize:4096});}catch(e){throw Error(`接続できませんでした。ほかのEV3アプリを閉じてください。${e.message}`);}
    this.transport='bluetooth';this.port=port; this.closing=false; this.framer=new Framer(f=>this.receive(f));
    this.writer=port.writable.getWriter();this.reader=port.readable.getReader();
    this.log('接続',JSON.stringify(port.getInfo()));
    this.pump=this.readLoop();this.changed(true);
  }
  // USBのデバイス選択・受信・切断処理を登録する。HID末尾の埋め草はパケットへ混ぜない。
  async connectUSB(){
    const hid=this.platform.navigator?.hid;
    if(!hid)throw Error('このブラウザではUSB接続（WebHID）を使えません。パソコンまたはChromebookのChromeで開いてください。');
    const [device]=await hid.requestDevice({filters:[{...EV3_USB_FILTER}]});
    if(!device){const error=Error('USB接続先の選択をキャンセルしました。');error.name='NotFoundError';throw error;}
    const reports=ev3HidReports(device);
    try{await device.open();}catch(e){throw Error('USB接続できませんでした。ほかのEV3アプリやEV3を開いているタブを閉じ、ケーブルを挿し直してください。学校の端末では管理者のUSB機器の利用設定も確認してください。'+e.message);}
    this.transport='usb';this.device=device;this.usbHid=hid;this.usbReports=reports;this.closing=false;
    this.usbInput=event=>{
      if(this.closing||this.device!==device||event.reportId!==reports.reportId)return;
      try{
        const data=new Uint8Array(event.data.buffer,event.data.byteOffset,event.data.byteLength);
        if(!data.length||data.every(b=>b===0))return;
        if(data.length<5)throw Error('USB応答が短すぎます。');
        const length=data[0]+256*data[1]+2;
        if(length<5||length>data.length||length>reports.inputSize)throw Error('USB応答の長さが不正です。');
        // HID pads the report. Only the declared EV3 packet goes to receive;
        // padding must never enter the Bluetooth stream framer.
        this.receive(data.slice(0,length));
      }catch(e){this.log('エラー',e.message);this.fail(e);void this.close();}
    };
    this.usbDisconnect=event=>{if(event.device!==device||this.device!==device)return;this.fail(Error('USBケーブルの接続が切れました。挿し直して「接続する」を押してください。'));void this.close();};
    device.addEventListener('inputreport',this.usbInput);hid.addEventListener('disconnect',this.usbDisconnect);
    this.writer={write:async bytes=>{
      if(this.device!==device||this.closing)throw Error('USB接続が切れています。');
      if(bytes.length>reports.outputSize)throw Error('USB通信の上限を超えています。EV3の保存先名・プログラム名を短くしてください。');
      const report=new Uint8Array(reports.outputSize);report.set(bytes);
      try{await device.sendReport(reports.reportId,report);}catch(e){void this.close();throw Error('USB送信に失敗しました。ケーブルを挿し直して再接続してください。'+e.message);}
    }};
    this.log('USB接続',JSON.stringify({name:device.productName??'EV3',inputBytes:reports.inputSize,outputBytes:reports.outputSize}));this.changed(true);
  }
  // 送信時の通番で待機中の要求と対応付ける。対応しない応答は次の要求へ流用しない。
  receive(frame){
    this.log('受信',hex(frame));
    const id=frame[2]+256*frame[3]; const p=this.pending.get(id);
    if(p){clearTimeout(p.timer);this.pending.delete(id);p.resolve(frame);}else this.log('補足',`対応する送信がない応答 #${id}`);
  }
  fail(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
  async readLoop(){
    try {while(!this.closing){const {value,done}=await this.reader.read();if(done)break;this.framer.push(value);}}
    catch(e){if(!this.closing)this.log('エラー',e.message);}
    finally {this.reader.releaseLock();if(!this.closing){this.fail(Error('EV3との接続が切れました。接続し直してください。'));this.changed(false);queueMicrotask(()=>this.close());}}
  }
  // 切断時は保留中の通信も失敗として解放する。USBのイベント登録、シリアルの読み書きロックも片付ける。
  async close(){
    if(this.closing)return;
    if(this.device){
      this.closing=true;const device=this.device;this.device=null;
      device.removeEventListener('inputreport',this.usbInput);this.usbHid.removeEventListener('disconnect',this.usbDisconnect);
      this.fail(Error('USB接続を切断しました。'));this.writer=null;
      try{if(device.opened)await device.close();}catch(e){this.log('補足',e.message);}
      this.usbReports=null;this.usbHid=null;this.usbInput=null;this.usbDisconnect=null;
      this.changed(false);this.log('切断','USBを切断しました。EV3本体から保存したプログラムを起動できます。');return;
    }
    if(!this.port)return;
    this.closing=true;const port=this.port;
    this.fail(Error('接続を切断しました。'));
    try {await this.reader.cancel();await this.pump;}catch{}
    try {this.writer.releaseLock();await port.close();}catch(e){this.log('補足',e.message);}
    this.port=null;this.changed(false);this.log('切断','EV3本体から保存したプログラムを起動できます。');
  }
  // 同時通信は1件に限定する。待ち受けを先に登録してから送信し、即時応答の取りこぼしを防ぐ。
  async request(type,payload,timeout=10000){
    if(!this.connected)throw Error('先にEV3に接続してください。');
    if(this.pending.size)throw Error('通信中です。完了を待ってください。');
    const id=(++this.counter)&65535;const bytes=packet(id,type,payload);
    const response=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('EV3から応答がありません（10秒）。接続先と本体の状態を確認して接続し直してください。'));void this.close();},timeout);
      this.pending.set(id,{resolve,reject,timer});
    });
    // Attach the rejection handler before writing, even if the browser write stalls.
    const sending=Promise.resolve().then(()=>this.writer.write(bytes)).catch(e=>this.fail(e));
    this.log('送信',hex(bytes));
    const result=await response;await sending;return result;
  }
  // ファイル操作用のシステムコマンド。応答種別・コマンド番号・許可したステータスをすべて確認する。
  async system(cmd,args=[],allowed=[0]){
    const f=await this.request(1,[cmd,...args]);
    if(f.length<7 || ![3,5].includes(f[4]) || f[5]!==cmd)throw Error('EV3の応答形式が一致しません。');
    if(!allowed.includes(f[6]))throw Error(`EV3: ${statusNames[f[6]]??'不明なエラー'} (0x${f[6].toString(16)})`);
    return {status:f[6],data:f.slice(7)};
  }
  async ping(){
    // opUI_READ(GET_FW_VERS, 32, GV0): a read-only identity check.
    const f=await this.request(0,[32,0,0x81,...constant(10),...constant(32),0x60]);
    if(f[4]!==2)throw Error('EV3の確認コマンドに失敗しました。標準ファームウェアか確認してください。');
    const fw=new TextDecoder().decode(f.slice(5)).split('\0')[0];this.log('本体',`ファームウェア: ${fw}`);return fw;
  }
  async signalTransferComplete(){
    // Direct command only: acknowledge verification with two short tones.
    // Never launch the downloaded program or send any motor instructions.
    const reply=await this.request(0,[0,0,
      OP.SOUND,...constant(1),...constant(25),...constant(660),...constant(80),OP.SOUND_READY,
      OP.SOUND,...constant(1),...constant(25),...constant(880),...constant(120),OP.SOUND_READY],3000);
    if(reply.length!==5||reply[4]!==2)throw Error('EV3が完了音の命令を受け付けませんでした。');
    this.log('完了音','照合完了後、660Hz→880Hzの短い完了音を送信しました。');
  }
  // 全バイト照合に成功してから完了音を送る。音の失敗とファイル保存の成功は分けて返す。
  async transferWithSignal(data,filename,onProgress,folder='EV3Lab'){
    const path=await this.transfer(data,filename,onProgress,folder);
    try{await this.signalTransferComplete();return {path,soundError:null};}
    catch(error){const soundError=error.message;this.log('完了音エラー','転送・照合は完了しています。'+soundError);return {path,soundError};}
  }
  async readMotorCounts(){
    // GET_COUNT uses zero-based port indexes (B=1, C=2), NOT output bit masks.
    // This reads sensor counts only; it neither starts nor resets a motor.
    const f=await this.request(0,[8,0,0xb3,0,1,0x60,0xb3,0,2,0x64]);
    if(f[4]!==2 || f.length!==13)throw Error('角度の読み取りに失敗しました。EV3との接続を確認してください。');
    const view=new DataView(f.buffer,f.byteOffset+5,8);
    const counts={B:view.getInt32(0,true),C:view.getInt32(4,true)};
    this.log('角度読取',JSON.stringify(counts));return counts;
  }
  // 本体で即座に実行する命令。応答用の共有メモリサイズを指定し、USBの送信上限も事前確認する。
  async directCommand(code,globalBytes=0,timeout=3000){
    if(!Number.isInteger(globalBytes)||globalBytes<0||globalBytes>1023)throw Error('読み取りサイズが不正です。');
    const payload=[...u16(globalBytes),...code];
    if(this.transport==='usb'&&this.usbReports&&payload.length+5>this.usbReports.outputSize)throw Error('このUSB接続ではプロジェクト名とプログラム名を短くしてください。');
    const reply=await this.request(0,payload,timeout);
    if(reply[4]!==2||reply.length!==5+globalBytes)throw Error('EV3が命令を受け付けませんでした。');
    return reply.slice(5);
  }
  async programStatus(){
    const value=await this.directCommand([0x0c,...constant(22),...constant(1),...globalVar(0),0x0c,...constant(24),...constant(1),...globalVar(1)],2);
    return {status:value[0],result:value[1]};
  }
  // 実行中のプログラムを上書きしないよう、USER_SLOTの状態を確認する。停止の指示自体は別操作で行う。
  async ensureProgramStopped(){
    if((await this.programStatus()).status!==0x40)throw Error('EV3でプログラムが実行中です。「実行を停止」または本体の戻るボタンで停止してから転送してください。');
  }
  programStartCode(path){
    if(!/^\.\.\/prjs\/[A-Za-z0-9_-]{1,31}\/[A-Za-z0-9_-]{1,31}\.rbf$/.test(path??''))throw Error('起動するプログラムの保存先が不正です。');
    // USER_SLOT=1; FILE(LOAD_IMAGE, slot, path, size, image), PROGRAM_START.
    return [0xc0,...constant(8),...constant(1),0x84,...zstr(path),...globalVar(0),...globalVar(4),0x03,...constant(1),...globalVar(0),...globalVar(4),...constant(0)];
  }
  async startProgram(path){
    const code=this.programStartCode(path);await this.ensureProgramStopped();
    await this.directCommand(code,8);
    const state=await this.programStatus();if(state.result===2)throw Error('EV3で実行エラーが発生しました。本体の表示とプログラムを確認してください。');
    this.log('起動',`${path} の起動命令をEV3が受け付けました。`);
  }
  // 転送・読み戻し照合が済んだパスだけを起動する。起動失敗時も照合済みパスを呼び出し元へ伝える。
  async transferAndRun(data,filename,onProgress,folder='EV3Lab'){
    const path=`${projectDirectory(folder)}/${filename}`,code=this.programStartCode(path);
    if(this.transport==='usb'&&this.usbReports&&code.length+7>this.usbReports.outputSize)throw Error('このUSB接続ではプロジェクト名とプログラム名を短くしてください。');
    await this.ensureProgramStopped();
    const result=await this.transferWithSignal(data,filename,onProgress,folder);
    try{await this.startProgram(result.path);}catch(error){error.verifiedPath=result.path;throw error;}
    return {...result,started:true};
  }
  async stopProgram(){
    await this.directCommand([OP.PROGRAM_STOP,...constant(1),OP.STOP,...constant(0),...constant(15),...constant(1)]);
    this.log('停止','ユーザープログラムとすべてのモーターへ停止命令を送信しました。');
  }
  // 接続中の画面表示用。センサのモードを変えず、各ポートを順番に読むため同一瞬間の測定ではない。
  async readSensorSnapshot(){
    const inputs=[];
    for(let port=0;port<4;port++){
      // TYPE_KEEP=0, MODE_KEEP=-1: observe the current mode without switching it.
      const bytes=await this.directCommand([OP.INPUT_DEVICE,...constant(5),...constant(0),...constant(port),...globalVar(0),...globalVar(1),0x9d,...constant(0),...constant(port),...constant(0),...constant(-1),...globalVar(4)],8);
      const value=new DataView(bytes.buffer,bytes.byteOffset).getFloat32(4,true);
      inputs.push({port:port+1,type:bytes[0],mode:bytes[1],value:Number.isFinite(value)?value:null});
    }
    const code=[];for(let port=0;port<4;port++)code.push(OP.INPUT_DEVICE,...constant(5),...constant(0),...constant(16+port),...globalVar(port*2),...globalVar(port*2+1),OP.MOTOR_COUNT,...constant(0),...constant(port),...globalVar(8+port*4));
    const bytes=await this.directCommand(code,24),view=new DataView(bytes.buffer,bytes.byteOffset);
    const motors=Array.from({length:4},(_,i)=>({port:'ABCD'[i],type:bytes[i*2],value:[7,8].includes(bytes[i*2])?view.getInt32(8+i*4,true):null}));
    return {inputs,motors};
  }
  async readTimingRecord(path,tag){
    if(!/^\.\.\/prjs\/[A-Za-z0-9_-]{1,31}\/FB_[0-9a-f]{8}\.bin$/.test(path??''))throw Error('停止タイミング補正モードのプログラムを転送・実行してください。');
    let data;
    try{data=await this.readFile(path);}catch(e){throw Error(`停止時刻の記録を読めません。0.1.6以降で転送した今回のファイルを実行してください。${e.message}`);}
    const record=decodeTimingRecord(data,tag);this.log('停止時刻記録',JSON.stringify(record));return record;
  }
  // ファイルハンドルを取得して分割送信する。途中失敗時は可能ならハンドルを閉じる。
  async writeFile(path,data,onProgress=()=>{}){
    const first=await this.system(0x92,[...u32(data.length),...zstr(path)]);
    if(first.data.length!==1)throw Error('保存先ハンドルの応答が不正です。');
    const handle=first.data[0];let finished=false;
    try {
      for(let at=0;at<data.length;at+=this.chunkSize){
        const chunk=data.slice(at,at+this.chunkSize),last=at+chunk.length===data.length;
        await this.system(0x93,[handle,...chunk],last?[0,8]:[0]);
        onProgress(Math.round(100*(at+chunk.length)/data.length));
      }
      finished=true;
    }finally{if(!finished && this.connected)try{await this.system(0x98,[handle]);}catch{}}
  }
  // EOFまで読み戻し、宣言サイズとも照合する。ブロック境界ぴったりのサイズでも最後の読み取りでハンドルを閉じる。
  async readCsv(folder,file){if((await this.programStatus()).status!==0x40)throw Error('ログの読み出し前に、EV3の実行を停止してください。');if(!/^[A-Za-z0-9_-]{1,31}$/.test(file??''))throw Error('CSVの名前は半角英数字・-・_で1〜31文字にしてください。');const bytes=await this.readFile(`${projectDirectory(folder)}/${file}.csv`,2*1024*1024);const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!text.startsWith('time_s,item,value\r\n'))throw Error('EV3 Block LabのCSVログではありません。');return text;}
  async readFile(path,maxSize=65536){
    const first=await this.system(0x94,[...u16(this.chunkSize),...zstr(path)],[0,8]);
    if(first.data.length<5)throw Error('読み戻しの応答が不正です。');
    const size=new DataView(first.data.buffer,first.data.byteOffset).getUint32(0,true);
    if(size>maxSize){if(first.status!==8&&first.data.length>=5)try{await this.system(0x98,[first.data[4]]);}catch{}throw Error('読み戻すファイルのサイズが上限を超えています。');}
    const handle=first.data[4];let bytes=Array.from(first.data.slice(5)),status=first.status;
    try {
      while(status!==8){
        // One extra read closes a handle if the size was an exact packet multiple.
        const next=await this.system(0x95,[handle,...u16(this.chunkSize)],[0,8]);
        if(next.data[0]!==handle)throw Error('読み戻しハンドルが一致しません。');
        if(next.status===0 && next.data.length<=1)throw Error('読み戻しが進みません。');
        bytes.push(...next.data.slice(1));status=next.status;
        if(bytes.length>size)throw Error('読み戻したファイルが予定サイズを超えています。');
      }
    }finally{if(status!==8 && this.connected)try{await this.system(0x98,[handle]);}catch{}}
    if(bytes.length!==size)throw Error('読み戻したファイルのサイズが一致しません。');
    return new Uint8Array(bytes);
  }
  // フォルダ作成 → ファイル送信 → 読み戻し → 全バイト比較を行う。送信完了だけでは成功扱いにしない。
  async transfer(data,filename,onProgress,folder='EV3Lab'){
    if(!/^[A-Za-z0-9_-]{1,31}\.rbf$/.test(filename))throw Error('本体用ファイル名が不正です。');
    const directoryPath=projectDirectory(folder);
    const path=`${directoryPath}/${filename}`;
    if(this.transport==='usb'&&this.usbReports&&10+zstr(path).length>this.usbReports.outputSize)throw Error('このUSB接続では、保存先名とプログラム名を合わせて短くしてください。USBハブを外して直接接続すると改善する場合があります。');
    // Stock firmware reports NO_PERMISSION for any mkdir() failure, including
    // EEXIST. Only tolerate it here; BEGIN_DOWNLOAD must still permit writing,
    // and success still requires a complete readback comparison.
    const directory=await this.system(0x9b,zstr(directoryPath),[0,5,7]);
    if(directory.status===5)this.log('保存先','フォルダー作成応答 0x05。既存フォルダーの可能性があるため、ファイル保存で確認します。');
    try{await this.writeFile(path,data,onProgress);}
    catch(e){throw Error(`実行ファイルの保存に失敗しました：${e.message}`);}
    const read=await this.readFile(path);
    if(read.length!==data.length || read.some((v,i)=>v!==data[i]))throw Error('転送後の照合に失敗しました。再転送してください。');
    this.log('照合完了',`${path} / ${data.length} bytes — 全バイト一致`);return path;
  }
}
export const hex = data => Array.from(data,x=>x.toString(16).padStart(2,'0')).join(' ');
