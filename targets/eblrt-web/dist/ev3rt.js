import {validate,programFileName} from './ev3.js';
import {dataRuntime} from './ev3rt-data-runtime.js';
import {extraLayout,isText} from './data.js';
import {pidLayout} from './pid.js';
import {MOTION_RUNTIME} from './ev3rt-motion.js';
import {parallelPlan} from './parallel.js';
import {taskEntry,parallelSource} from './ev3rt-tasks.js';
import {MOTOR_RUNTIME} from './ev3rt-motor-runtime.js';
import {cComment,cCommentLines,blockDescription,procedureComment,CODE_GUIDE} from './ev3rt-comments.js';
import {splitMyBlocks} from './ev3rt-c-modules.js';
import {cFloatLiteral} from './ev3rt-float.js';
import {myBlockParameterNames,myBlockFunctionNames} from './ev3rt-identifiers.js';

export const EV3RT_NOTICE='EV3-RT出力は試作版です。モーターはEV3-RTのAPIで制御します。標準EV3との速度・停止特性の比較は実機確認が必要です。コンパイル・転送にはPCの補助アプリを使います。';
const unsupported = name => {
  const labels={ramp:'加減速',motorPower:'パワー指定',stopMode:'停止方法の共通設定',motorSpeedSet:'動作中の速度変更',movementSetup:'動きのモーター設定',tank:'左右別速度',tankFinite:'左右別速度の角度・時間指定',drive:'距離移動',spin:'スピンターン',pivot:'ピボットターン',steering:'ステアリング',wheel:'タイヤ直径',tread:'トレッド',broadcast:'メッセージ送信',logStart:'CSV記録の開始',logValue:'CSV記録',logEnd:'CSV記録の終了',pidReset:'PIDリセット',textSet:'文字列変数',listClear:'リスト',listAdd:'リスト',listSet:'リスト',listDelete:'リスト',pid:'PID計算',text:'文字列',textVar:'文字列変数',textOp:'文字列演算',textData:'文字列演算',listData:'リスト演算'};
  throw Error('EV3-RT出力は未対応です: '+(labels[name]??name)+'。対応するブロックへ変更するか、通常の.rbf出力を使ってください。');
};

// This backend consumes the same IR as RBF, without calling the RBF compiler.
// Unsupported semantics fail the whole export; no instructions are skipped.
export function exportEV3RT(program,{name='EV3Lab',motorTypes={}}={}) {
  programFileName(name);
  validate(program);
  let parallel=parallelPlan(program,{separateGyroModes:true});
  const data=extraLayout(program,0,''),pids=pidLayout(program,0);
  const features={text:data.texts.size>0,list:data.lists.size>0,pid:pids.controllers.size>0,log:data.logs};
  const inspect=x=>{if(!x||typeof x!=='object')return;if(isText(x)||x.textData)features.text=true;if(x.numeric?.op==='random')features.random=true;if(x.button)features.button=true;if(x.sensor?.kind?.startsWith('ir')&&x.sensor.kind!=='infrared')features.ir=true;if(x.type==='displayNumber')features.display=true;if(x.type==='led'){if(x.mode==='pulse')throw Error('EV3-RT: ランプの明滅（滑らかな明るさ変化）は公開APIに明るさ指定がないため対応できません。点灯または点滅を使ってください。');features.led=true;}for(const v of Object.values(x))inspect(v);};inspect(program);if(features.log)features.text=true;
  const textVars=new Map([...data.texts.keys()].map((n,i)=>[n,'lab_text_'+i])),lists=new Map([...data.lists.keys()].map((n,i)=>[n,'lab_list_'+i])),controllers=new Map([...pids.controllers.keys()].map((n,i)=>[n,'lab_pid_'+i]));
  const needsHold=node=>node&&typeof node==='object'&&((node.type==='stop'&&node.stopMode==='hold')||(node.type==='stopMode'&&node.mode==='hold')||Object.values(node).some(needsHold));
  if(!parallel&&(needsHold(program)||features.led)){
    const plan=parallelPlan({...program,threads:[{kind:'start',body:[]}]});parallel={...plan,roots:plan.roots.slice(0,1)};
  }
  const variables=new Map(),sensors=new Map(),motors=new Set(),bitmaps=[];
  const functionNames=myBlockFunctionNames(program.procedures.map(p=>p.name));
  const procs=new Map(program.procedures.map((p,i)=>[p.name,{...p,id:functionNames[i],cParams:myBlockParameterNames(p.params,functionNames)}]));
  let serial=0,lines=[],level=0,current=null;
  const commentSlots=[];
  // Restore project-authored prose only after runtime template transformations.
  const saveComment=comment=>{const i=commentSlots.push(comment)-1;return '/* EBL_COMMENT_'+i+' */';};
  const emit=s=>lines.push('    '.repeat(level)+s);
  const variable=n=>{if(!variables.has(n))variables.set(n,'lab_var_'+variables.size);return variables.get(n);};
  const maskPorts=mask=>{if(!Number.isInteger(mask)||mask<1||mask>15)throw Error('モーターポートを確認してください。');return [0,1,2,3].filter(i=>mask&(1<<i));};
  const useMotors=mask=>{for(const i of maskPorts(mask))motors.add(i);return mask;};
  const sensor=(port,type)=>{const old=sensors.get(port);if(old&&old!==type)throw Error('EV3-RT: 同じセンサーポートに異なる種類が指定されています。');sensors.set(port,type);};
  const temp=code=>{const id='lab_tmp_'+serial++;emit('float '+id+' = lab_number('+code+');');return id;};
  const results=p=>p.returns?(p.results??[p.result]):[];
  function call(b) {
    const p=procs.get(b.name);if(!p)throw Error('マイブロックの定義がありません。');
    const args=b.args.map(expr),id='lab_result_'+serial++;
    if(!b.type)emit(saveComment(cComment('式の中でマイブロック「'+b.name+'」を呼び出し、戻り値を受け取る。')));
    emit('lab_values '+id+' = '+p.id+'('+args.join(', ')+');');
    emit('(void)'+id+';');return id;
  }
  // C文字列にはUTF-8の各バイトを8進数で埋め込み、入力由来のC構文を作らない。
  const cstr=value=>'"'+[...new TextEncoder().encode(value)].map(b=>'\\'+b.toString(8).padStart(3,'0')).join('')+'"';
  function text(x) {
    let code;
    if(x.text!==undefined)code='lab_text_make('+cstr(x.text)+')';
    else if(x.textVar!==undefined)code='lab_text_load(&'+textVars.get(x.textVar)+')';
    else if(x.textOp==='join'){const a=text(x.a),b=text(x.b);code='lab_text_join('+a+', '+b+')';}
    else if(x.textOp==='letter'){const a=text(x.value),i=expr(x.index);code='lab_text_letter('+a+', '+i+')';}
    else if(x.textOp==='number')code='lab_text_number('+expr(x.value)+')';
    else unsupported('text');
    const id='lab_string_'+serial++;emit('lab_text '+id+' = '+code+';');return id;
  }
  function expr(x) {
    if(typeof x==='number')return temp(cFloatLiteral(x));
    if(x?.var!==undefined)return temp(parallel?'lab_load(&'+variable(x.var)+')':variable(x.var));
    if(x?.param!==undefined){const i=current?.params.indexOf(x.param)??-1;if(i<0)throw Error('引数を確認してください。');return temp(current.cParams[i]);}
    if(x?.callValue)return temp(call(x.callValue)+'.value['+(x.callValue.output??0)+']');
    if(x?.not!==undefined)return temp('!'+expr(x.not));
    if(x?.op){
      const a=expr(x.left),b=expr(x.right),ops={add:'+',sub:'-',mul:'*',div:'/',eq:'==',neq:'!=',lt:'<',lte:'<=',gt:'>',gte:'>=',and:'&&',or:'||'};
      if(!ops[x.op])unsupported(x.op);if(x.op==='div')emit('if ('+b+' == 0) lab_fail();');
      return temp('('+a+' '+ops[x.op]+' '+b+')');
    }
    if(x?.button)return temp('lab_button('+x.button.id+')');
    if(x?.pid){const p=x.pid,args=['target','measured','kp','ki','kd'].map(k=>expr(p[k]));return temp('lab_pid_compute(&'+controllers.get(p.name)+', '+args.join(', ')+')');}
    if(x?.textData){const d=x.textData,a=text(d.value);if(d.op==='length')return temp('lab_text_length('+a+')');if(d.op==='number')return temp('lab_text_parse('+a+')');const b=text(d.other);return temp('lab_text_compare('+a+', '+b+', '+(d.op==='equal'?1:0)+')');}
    if(x?.listData){const d=x.listData,op={length:0,item:1,contains:2,sum:3,average:4,min:5,max:6}[d.op],v=d.op==='item'?expr(d.index):d.op==='contains'?expr(d.value):'0';return temp('lab_list_read(&'+lists.get(d.list)+', '+op+', '+v+')');}
    if(x?.timer)return temp(parallel?'lab_timer_value()':'lab_elapsed(lab_timer_start) / 1000000.0f');
    if(x?.battery)return temp(x.battery==='voltage'?'ev3_battery_voltage_mV() / 1000.0f':'ev3_battery_current_mA() / 1000.0f');
    if(x?.sensor){
      const {kind,port}=x.sensor,p='EV3_PORT_'+port;
      if(kind==='encoder'){useMotors(1<<(port-1));return temp('ev3_motor_get_counts(EV3_PORT_'+ 'ABCD'[port-1]+')');}
      if(kind==='motorSpeed'){useMotors(1<<(port-1));return temp('ev3_motor_get_power(EV3_PORT_'+ 'ABCD'[port-1]+')');}
      if(['irRemote','irBeaconDetected','irBeaconDistance','irBeaconHeading'].includes(kind)){sensor(port,'INFRARED_SENSOR');return temp('lab_ir('+(port-1)+', '+(x.sensor.channel-1)+', '+({irRemote:0,irBeaconDetected:1,irBeaconDistance:2,irBeaconHeading:3}[kind])+')');}
      const spec={touch:['TOUCH_SENSOR','ev3_touch_sensor_is_pressed'],color:['COLOR_SENSOR','ev3_color_sensor_get_color'],reflected:['COLOR_SENSOR','ev3_color_sensor_get_reflect'],distance:['ULTRASONIC_SENSOR','ev3_ultrasonic_sensor_get_distance'],gyroAngle:['GYRO_SENSOR','ev3_gyro_sensor_get_angle'],gyroRate:['GYRO_SENSOR','ev3_gyro_sensor_get_rate'],infrared:['INFRARED_SENSOR','ev3_infrared_sensor_get_distance']}[kind];
      if(!spec)unsupported('センサー '+kind);sensor(port,spec[0]);
      return temp(spec[1]+'('+p+')'+(kind==='gyroAngle'?(parallel?' - lab_gyro_offset('+(port-1)+')':' - lab_gyro_zero['+(port-1)+']'):''));
    }
    if(x?.math){
      const a=expr(x.math.value),fn=x.math.fn;
      const simple={abs:'fabsf',floor:'floorf',ceil:'ceilf',sqrt:'sqrtf',ln:'logf',log:'log10f',exp:'expf'};
      if(simple[fn])return temp(simple[fn]+'('+a+')');
      if(['sin','cos','tan'].includes(fn))return temp(fn+'f('+a+' * 0.0174532925199433f)');
      if(['asin','acos','atan'].includes(fn))return temp(fn+'f('+a+') * 57.2957795130823f');
      if(fn==='pow10')return temp('powf(10.0f, '+a+')');unsupported('数値関数 '+fn);
    }
    if(x?.numeric){const n=x.numeric,a=expr(n.a),b=n.b===undefined?null:expr(n.b);
      if(n.op==='random')return temp('lab_random('+a+', '+b+')');
      if(n.op==='mod'){emit('if ('+b+' == 0) lab_fail();');return temp('fmodf('+a+', '+b+')');}
      if(n.op==='min'||n.op==='max')return temp((n.op==='min'?'fminf':'fmaxf')+'('+a+', '+b+')');
      if(n.op==='round')return temp('floorf('+a+' + 0.5f)');
      if(n.op==='clamp'){const low=expr(n.low),high=expr(n.high);emit('if ('+low+' > '+high+') lab_fail();');return temp('fminf('+high+', fmaxf('+low+', '+a+'))');}
      unsupported('データ演算 '+n.op);
    }
    unsupported(Object.keys(x??{}).join('/'));
  }
  function returnValues(values) {const args=values.map(expr);emit('return (lab_values){{'+(args.join(', ')||'0')+'}};');}
  function block(nodes) {
    for(const b of nodes){
      emit(saveComment(cComment('ブロック：'+blockDescription(b))));
      const ports=()=>useMotors(b.ports??15);
      switch(b.type){
        case 'textSet':emit('lab_text_store(&'+textVars.get(b.name)+', '+text(b.value)+');');break;
        case 'listClear':emit('lab_list_clear(&'+lists.get(b.list)+');');break;
        case 'listAdd':emit('lab_list_add(&'+lists.get(b.list)+', '+expr(b.value)+');');break;
        case 'listSet':{const i=expr(b.index),v=expr(b.value);emit('lab_list_set(&'+lists.get(b.list)+', '+i+', '+v+');');break;}
        case 'listDelete':emit('lab_list_delete(&'+lists.get(b.list)+', '+expr(b.index)+');');break;
        case 'pidReset':emit('lab_pid_reset(&'+controllers.get(b.name)+');');break;
        case 'logStart':emit('lab_log_begin('+cstr('/EBL_'+name+'_'+b.file+'.csv')+');');break;
        case 'logEnd':emit('lab_log_end();');break;
        case 'logValue':{const v=text(isText(b.value)?b.value:{textOp:'number',value:b.value});emit('lab_log_value('+cstr(b.label)+', '+v+', '+(isText(b.value)?'true':'false')+');');break;}
        case 'movementSetup':{useMotors(b.leftPort|b.rightPort);emit('lab_pair_setup('+maskPorts(b.leftPort)[0]+', '+maskPorts(b.rightPort)[0]+');');break;}
        case 'wheel':emit((parallel?'lab_lock(); ':'')+'lab_diameter = '+(Math.round(b.diameter*10)/10).toFixed(1)+'f;'+(parallel?' lab_unlock();':''));break;
        case 'tread':emit((parallel?'lab_lock(); ':'')+'lab_track = '+(Math.round(b.mm*10)/10).toFixed(1)+'f;'+(parallel?' lab_unlock();':''));break;
        case 'ramp':emit('lab_ramp('+({off:0,trapezoid:1,scurve:2}[b.mode])+', '+expr(b.upSeconds)+', '+expr(b.downSeconds)+');');break;
        case 'steering':{const turn=expr(b.turn),speed=expr(b.speed),amount=b.action==='angle'?expr(b.degrees):'0',seconds=b.action==='time'?expr(b.seconds):'0';emit('lab_steering('+turn+', '+speed+', '+amount+', '+seconds+', '+(b.action==='run'?0:1)+');');break;}
        case 'tank':case 'tankFinite':{const l=expr(b.leftSpeed),r=expr(b.rightSpeed),amount=b.action==='angle'?expr(b.degrees):'0',seconds=b.action==='time'?expr(b.seconds):'0';emit('lab_tank('+l+', '+r+', '+amount+', '+seconds+', '+(b.type==='tank'?0:1)+');');break;}
        case 'drive':{const speed=expr(b.speed),cm=expr(b.cm);emit('lab_steering(0, '+(b.direction==='backward'?'-':'')+speed+', lab_geometry(0, '+cm+'), 0, 1);');break;}
        case 'spin':case 'pivot':{const speed=expr(b.speed),angle=expr(b.angle),turn=(b.direction==='right'?1:-1)*(b.type==='spin'?100:50);emit('lab_steering('+turn+', '+speed+', lab_geometry('+(b.type==='spin'?1:2)+', '+angle+'), 0, 1);');break;}
        case 'set':case 'change':{const v=expr(b.value);emit(parallel?(b.type==='set'?'lab_store':'lab_add')+'(&'+variable(b.var)+', '+v+');':variable(b.var)+(b.type==='set'?' = ':' = lab_number('+variable(b.var)+' + ')+v+(b.type==='set'?';':');'));break;}
        case 'broadcast':if(parallel)emit('lab_send('+parallel.messages.get(b.message)+', '+(b.wait?'true':'false')+');');break;
        case 'wait':case 'waitSeconds':emit('lab_wait('+expr(b.type==='wait'?b.ms:b.seconds)+(b.type==='waitSeconds'?' * 1000.0f':'')+');');break;
        case 'repeat':{const count=expr(b.count),id=serial++;emit('int lab_count_'+id+' = lab_integer('+count+', 0, 10000);');emit('for (int lab_i_'+id+' = 0; lab_i_'+id+' < lab_count_'+id+'; ++lab_i_'+id+') {');level++;block(b.body);emit('lab_poll();');level--;emit('}');break;}
        case 'while':case 'forever':emit('for (;;) {');level++;if(b.type==='while'){const c=expr(b.condition);emit('if ('+(b.until?'':'!')+'('+c+')) break;');}block(b.body);emit('lab_poll();');level--;emit('}');break;
        case 'if':{const c=expr(b.condition);emit('if ('+c+') {');level++;block(b.then);level--;emit('} else {');level++;block(b.else??[]);level--;emit('}');break;}
        case 'call':call(b);break;
        case 'callOutputs':{const r=call(b);if(parallel)emit('lab_lock();');b.targets.forEach((n,i)=>emit(variable(n)+' = '+r+'.value['+i+'];'));if(parallel)emit('lab_unlock();');break;}
        case 'returnValue':returnValues([b.value]);break;
        case 'returnValues':returnValues(b.values);break;
        case 'myblockReturn':returnValues(results(current));break;
        case 'programEnd':emit('lab_fail();');break;
        case 'motorRun':emit('lab_run_extended('+ports()+', '+expr(b.speed)+');');break;
        case 'motorTimed':emit('lab_finite('+ports()+', '+expr(b.speed)+', 0, '+expr(b.seconds)+', 0);');break;
        case 'motorSpeedSet':emit('lab_speed_set('+ports()+', '+expr(b.speed)+');');break;
        case 'motorPower':{
          const mask=ports();for(const i of maskPorts(mask))if(motorTypes['ABCD'[i]]==='medium')throw Error('EV3-RT: Mモーターの未調整パワーは公開APIで種類を維持できません。「EV3RTの制約・相違点」を確認してください。');
          emit('lab_raw_power('+mask+', '+expr(b.speed)+');');break;
        }
        case 'stopMode':emit('lab_stop_mode('+ports()+', '+({brake:0,coast:1,hold:2}[b.mode])+');');break;
        case 'motor':case 'motorRotations':{
          const p=ports();
          const speed=expr(b.speed),amount=expr(b.type==='motor'?b.degrees:b.rotations);
          const degrees=amount+(b.type==='motorRotations'?' * 360.0f':'');
          if(maskPorts(p).length===2&&b.mode==='sync'){const pair=maskPorts(p);emit('lab_motion('+pair[0]+', '+pair[1]+', '+speed+', 0, '+degrees+', 0, 1);');}
          else emit('lab_finite('+p+', '+speed+', '+degrees+', 0, '+(b.mode==='feedback'?1:0)+');');break;
        }
        case 'stop':emit('lab_stop_selected('+(b.movement?'lab_movement_mask()':ports())+', '+({brake:0,coast:1,hold:2}[b.stopMode]??-1)+');');break;
        case 'encoderReset':useMotors(1<<(b.port-1));emit('lab_encoder_reset('+(b.port-1)+');');break;
        case 'gyroReset':sensor(b.port,'GYRO_SENSOR');emit((parallel?'lab_lock(); ':'')+'lab_gyro_zero['+(b.port-1)+'] = ev3_gyro_sensor_get_angle(EV3_PORT_'+b.port+');'+(parallel?' lab_unlock();':''));break;
        case 'timerReset':emit((parallel?'lab_lock(); ':'')+'lab_check(get_tim(&lab_timer_start));'+(parallel?' lab_unlock();':''));break;
        case 'tone':{const f=expr(b.frequency),t=expr(b.ms);emit('lab_lock();');emit('lab_check(ev3_speaker_set_volume('+b.volume+'));');emit('lab_check(ev3_speaker_play_tone(lab_integer('+f+', 250, 10000), lab_integer('+t+', 1, 60000)));');emit('lab_unlock();');emit('lab_wait('+t+');');break;}
        case 'led':emit('lab_led('+['LED_OFF','LED_GREEN','LED_RED','LED_ORANGE'][b.color]+', '+(b.mode==='flash'?1:0)+');');break;
        case 'displayClear':emit('lab_lock(); lab_check(ev3_lcd_fill_rect(0, 0, 178, 128, EV3_LCD_WHITE)); lab_unlock();');break;
        case 'displayBitmap':{const id=bitmaps.length;bitmaps.push(b.bitmap);emit('lab_bitmap('+id+', '+b.x+', '+b.y+');');break;}
        // Generated dot glyphs preserve numeric content and size; document the font difference.
        case 'displayNumber':emit('lab_display_number('+expr(b.value)+', '+b.x+', '+b.y+', '+(b.font===2?1:0)+', '+b.decimals+');');break;
        default:unsupported(b.type);
      }
      emit('lab_poll();');
    }
  }
  const functions=[];
  for(const p of procs.values()){
    current=p;lines=[];level=1;for(const identifier of p.cParams)emit('(void)'+identifier+';');
    block(p.body);emit(cComment(p.returns?'このマイブロックの最後まで来たので、設定された値を返す。':'このマイブロックの処理を終え、呼び出し元へ戻る。'));returnValues(results(p));functions.push(saveComment(procedureComment(p))+'\nstatic lab_values '+p.id+'('+p.cParams.map(identifier=>'float '+identifier).join(', ')+(p.params.length?'':'void')+') {\n'+lines.join('\n')+'\n}');
  }
  current=null;lines=[];level=2;if(!parallel)block(program.main);const main=lines.join('\n');
  const roots=parallel?.roots??[];
  const bodies=[],conditions=[];
  for(const r of roots){
    lines=[];level=4;if(r.condition!==undefined){const value=expr(r.condition);conditions.push({code:lines.join('\n'),value});}else conditions.push(null);
    lines=[];block(r.body);bodies.push(lines.join('\n'));
  }
  const entries=parallel?taskEntry(roots.map(r=>({...r,messageId:parallel.messages.get(r.message)})),bodies,conditions,saveComment):'';
  // Stop-only and encoder-only ports also require a configured motor.
  const motorConfig=[...motors].sort().map(i=>{const type=motorTypes['ABCD'[i]]??'large';if(!['large','medium'].includes(type))throw Error('L/Mモーターの種類を確認してください。');return '    '+cComment('ポート'+ 'ABCD'[i]+'を'+(type==='medium'?'M':'L')+'モーターとして使う。実際の配線と合わせる。')+'\n    lab_check(ev3_motor_config(EV3_PORT_'+'ABCD'[i]+', '+(type==='medium'?'MEDIUM_MOTOR':'LARGE_MOTOR')+'));';}).join('\n');
  const sensorConfig=[...sensors].sort(([a],[b])=>a-b).map(([p,t])=>'    '+cComment('入力ポート'+p+'のセンサーの種類を '+t+' に設定する。')+'\n    lab_check(ev3_sensor_config(EV3_PORT_'+p+', '+t+'));').join('\n');
  const bitmapData=bitmaps.map((b,i)=>'static const char lab_image_'+i+'[] = "'+b.rows.join('')+'";').join('\n');
  const bitmapCases=bitmaps.map((b,i)=>'    case '+i+': pixels=lab_image_'+i+'; w='+b.width+'; h='+b.height+'; break;').join('\n');
  const prototypes=[...procs.values()].map(p=>'static lab_values '+p.id+'('+p.cParams.map(identifier=>'float '+identifier).join(', ')+(p.params.length?'':'void')+');').join('\n');
  let source=`${cCommentLines([
    'EV3 Block Lab から自動生成した、学習用コメント付きCコードです。',
    '【読む順番】このファイルの「ブロックから生成したプログラム」から読んでください。',
    parallel?'作品のスタート・イベントは lab_task_0 などの関数です。main_task は起動と停止を管理します。':'作品の「スタート」からの処理は main_task の中にあります。',
    'マイブロックは ebl_myblocks.c の関数です。forwardなどの安全な関数名・引数名はブロックと同じにします。変換した名前はコメントで対応を示します。',
    '関数の引数名は、Cで安全に使える場合はブロックと同じ名前です。変換時は対応をコメントに残します。',
    'lab_var_* は共有変数、lab_arg_* は変換が必要な引数、lab_tmp_* は計算の途中の値です。',
    'ポートの組合せは A=1、B=2、C=4、D=8 の合計で表します。例：6はBとCです。',
    'lab_* の補助関数と共有変数の宣言は ebl_rt_runtime.h にあります。C言語の標準関数とは区別してください。',
    '数値は float です。20.0f は20、0.5f は0.5を表し、末尾のfがfloat型を示します。',
    '詳しくは、同じフォルダーの CODE_GUIDE.txt を参照してください。',
    'コメントは説明です。実際の動作はコメントの下のCコードで決まります。'
  ])}
/* Generated by EV3 Block Lab: EV3RT/HRP3 C source prototype.
 * Continuous/timed speed percentages use ev3_motor_set_power on L/M motors.
 * L/M speed uses the HRP3 regulator. Raw power is available for L only.
 * Independent profiles, completion feedback and hold use generated software control.
 * Compare speed and stopping behavior on physical hardware before use.
 * Check the L/M motor configuration below before building/running.
 */
#include "app.h"
#include <math.h>
#include <setjmp.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

typedef struct { float value[8]; } lab_values; /* マイブロックの数値を最大8個まとめて返す箱です。 */
static jmp_buf lab_exit;
${parallel?'':`static void lab_lock(void) {}\nstatic void lab_unlock(void) {}\nstatic void lab_motor_begin(unsigned mask) {(void)mask;}\nstatic bool lab_motor_valid(unsigned mask) {(void)mask;return true;}`}
static const int lab_motor_types[4]={${[...'ABCD'].map(p=>motorTypes[p]==='medium'?'MEDIUM_MOTOR':'LARGE_MOTOR').join(',')}};
static void lab_aux_tick(void);
static void lab_motor_stopped(unsigned mask);
static ER lab_regulated_write(motor_port_t port,int command);
static void lab_complete(unsigned mask);
static void lab_sync_begin(unsigned mask);
static void lab_continuous_steer(int left,int right,int power,int ratio);
static SYSTIM lab_timer_start;
static int lab_gyro_zero[4];
${[...variables].map(([name,v])=>'static float '+v+'; '+saveComment(cComment('EBLの変数「'+name+'」。プログラム全体で共有する数値。'))).join('\n')}
static const unsigned lab_motor_mask = ${[...motors].reduce((m,i)=>m|(1<<i),0)};
/* ===== 自動生成の補助処理：まずは後半の作品の処理から読んでください ===== */
/* 指定したモーターポートを停止する、低い層の共通処理です。 */
static void lab_stop(unsigned mask, bool brake) {
    lab_motor_stopped(mask);
    for (int i=0; i<4; ++i) if ((mask & lab_motor_mask) & (1U<<i)) ev3_motor_stop((motor_port_t)i, brake);
}
${parallel?'':'static void lab_finish(unsigned mask) {lab_stop(mask,true);}'}
static void lab_fail(void) { lab_stop(15, true); longjmp(lab_exit, 1); }
static void lab_check(ER result) { if (result != E_OK) lab_fail(); }
static float lab_number(float n) { if (!isfinite(n)) lab_fail(); return n; }
/* モーターの速さは計算後に-100～100へ収める。非数はエラー。 */
static int lab_motor_percent(float n) {return (int)truncf(fmaxf(-100.0f,fminf(100.0f,lab_number(n))));}
static int lab_integer(float n, int low, int high) {
    lab_number(n); n=truncf(n); if (n < low || n > high) lab_fail(); return (int)n;
}
/* 停止ボタンを確認し、ほかのタスクにCPUを使う機会を渡します。 */
static void lab_poll(void) {
    if (ev3_button_is_pressed(BACK_BUTTON)) lab_fail();
    ER er=tslp_tsk(1000); /* HRP3: microseconds */
    if (er!=E_OK && er!=E_TMOUT) lab_fail();
}
static double lab_elapsed(SYSTIM start) {
    SYSTIM now; lab_check(get_tim(&now)); return (double)(now-start);
}
/* ミリ秒単位の待機。単にCPUを占有せず、待機中も停止要求を確認します。 */
static void lab_wait(float milliseconds) {
    lab_number(milliseconds); if (milliseconds < 0 || milliseconds > 3600000) lab_fail();
    SYSTIM start; lab_check(get_tim(&start));
    while (lab_elapsed(start) < (double)milliseconds*1000.0) lab_poll();
}
static void lab_run(unsigned mask, float speed) {
    int power=lab_motor_percent(speed);
    for (int i=0; i<4; ++i) if (mask & (1U<<i)) lab_check(ev3_motor_set_power((motor_port_t)i, power));
}
static void lab_rotate(unsigned mask, float speed, float amount) {
    int power=lab_motor_percent(speed),degrees=lab_integer(amount, 1, 2147483000);
    if (power==0) lab_fail();
    int32_t origin[4]={0};
    for (int i=0; i<4; ++i) if (mask & (1U<<i)) {
        origin[i]=ev3_motor_get_counts((motor_port_t)i);
        lab_check(ev3_motor_rotate((motor_port_t)i, power<0?-degrees:degrees, power<0?-power:power, false));
    }
    SYSTIM start; lab_check(get_tim(&start));
    for (;;) {
        bool done=true;
        for (int i=0; i<4; ++i) if (mask & (1U<<i)) {
            double delta=(double)ev3_motor_get_counts((motor_port_t)i)-origin[i];
            if ((power<0?-delta:delta) < degrees) done=false;
        }
        if (done) break;
        if (lab_elapsed(start) > 180000000.0) lab_fail();
        lab_poll();
    }
    lab_stop(mask, true);
}
/* 二輪ロボットの同期走行、距離と旋回角度の換算を行う補助処理です。 */
${MOTION_RUNTIME}
/* EBL_MOTOR_EXTENSION */
${dataRuntime(features)}
${features.led?'':'static void lab_aux_tick(void) {}'}
${[...textVars].map(([n,id])=>'static lab_text '+id+'; '+saveComment(cComment('文字列変数「'+n+'」。UTF-8で120バイトまで。'))).join('\n')}
${[...lists].map(([n,id])=>'static lab_list '+id+'; '+saveComment(cComment('数値リスト「'+n+'」。1000項目まで。'))).join('\n')}
${[...controllers].map(([n,id])=>'static lab_pid '+id+'; '+saveComment(cComment('PID制御器「'+n+'」の前回値を記憶する。'))).join('\n')}
${bitmapData}
static void lab_bitmap(int id, int x, int y) {
    lab_lock();
    const char *pixels=0; int w=0,h=0;
    switch (id) {
${bitmapCases}
    default: lab_fail(); return;
    }
    lab_check(ev3_lcd_fill_rect(x,y,w,h,EV3_LCD_WHITE));
    for (int row=0; row<h; ++row) for (int col=0; col<w; ++col)
        if (pixels[row*w+col]=='1' && x+col>=0 && x+col<178 && y+row>=0 && y+row<128)
            lab_check(ev3_lcd_fill_rect(x+col,y+row,1,1,EV3_LCD_BLACK));
    lab_unlock();
}
/* ===== ブロックから生成したプログラム：ここから読み始めます ===== */
/* マイブロックの関数を、呼び出す前に宣言します。 */
/* EBL_MYBLOCKS_BEGIN */
${prototypes}
${functions.join('\n\n')}
/* EBL_MYBLOCKS_END */
${entries}
${parallel?'/* 監督用のメインタスク：作品の処理は上のlab_task_*にあります。 */':'/* 「スタート」につながる命令を、初期設定の後に上から実行します。 */'}
void main_task(intptr_t exinf) {
    (void)exinf;
    if (setjmp(lab_exit) != 0) { ext_tsk(); return; }
${motorConfig}
${sensorConfig}
${sensors.size?'    lab_wait(500); /* sensor initialization */':''}
    lab_check(get_tim(&lab_timer_start));
    {
${main}
    }
    lab_stop(15, true);
    ext_tsk();
}
`;
  if(parallel)source=parallelSource(source,roots,parallel.messages,[motorConfig,sensorConfig,sensors.size?'    lab_wait(500); /* sensor initialization */':'','    lab_check(get_tim(&lab_timer_start));'].join('\n'));
  source=source.replaceAll('ev3_motor_set_power((motor_port_t)i, power)','lab_regulated_write((motor_port_t)i, power)')
    .replace(parallel?'unsigned mask=(1U<<left)|(1U<<right);lab_motor_begin(mask);':'unsigned mask=(1U<<left)|(1U<<right);',parallel?'unsigned mask=(1U<<left)|(1U<<right);lab_motor_begin(mask);if(finite)lab_sync_begin(mask);':'unsigned mask=(1U<<left)|(1U<<right);if(finite)lab_sync_begin(mask);')
    .replaceAll('    lab_stop(mask,true);\n}', '    lab_complete(mask);\n}')
    .replaceAll('    lab_finish(mask);\n}', '    lab_complete(mask);\n}')
    .replace('/* EBL_MOTOR_EXTENSION */',MOTOR_RUNTIME);
  source=source.replace('            lab_hold_tick();','            lab_hold_tick(); lab_aux_tick();');
  // Split only after all runtime transformations, but before restoring user prose.
  // The include expands in precisely the original order, in the same C translation unit.
  const runtimeStart=source.indexOf('#include <math.h>');
  const programMarker='/* ===== ブロックから生成したプログラム：ここから読み始めます ===== */';
  const programStart=source.indexOf(programMarker);
  if(runtimeStart<0||programStart<=runtimeStart||source.indexOf(programMarker,programStart+1)>=0)throw Error('EV3-RT runtime split template mismatch');
  let runtime='#pragma once\n'+cCommentLines([
    'EBL-RTが自動生成した補助処理です。最初に読むファイルは app.c です。',
    '型・補助関数の宣言と、externによる共有変数の宣言を収録します。',
    '実体は ebl_rt_runtime.c にあり、app.c・ebl_myblocks.c と別々にコンパイルしてリンクします。',
    '作品ごとに生成するため、app.cと必ず同じ出力一式を使ってください。'
  ])+'\n'+source.slice(runtimeStart,programStart);
  source=source.slice(0,runtimeStart)+'/* 内部の補助処理を読み込みます。作品の命令はこの下にあります。 */\n#include "ebl_rt_runtime.h"\n\n'+source.slice(programStart);
  const modules=splitMyBlocks(source,runtime,prototypes);
  const restoreComments=text=>text.replace(/\/\* EBL_COMMENT_(\d+) \*\//g,(_,i)=>commentSlots[Number(i)]);
  source=restoreComments(modules.source.replace('#include "ebl_rt_runtime.h"','#include "ebl_rt_runtime.h"\n#include "ebl_myblocks.h"'));
  runtime=restoreComments(modules.runtimeHeader);
  const runtimeSource=restoreComments(modules.runtimeSource),myblocksHeader=restoreComments(modules.myblocksHeader),myblocksSource=restoreComments(modules.myblocksSource);
  const appHeader=`/* EV3RTから呼び出される関数の宣言と、タスク用の共通設定です。 */
#pragma once
#include "ev3api.h"
#include "target_test.h"
#define STACK_SIZE 16384 /* 各タスクの作業領域。単位はバイトです。 */
#ifndef TOPPERS_MACRO_ONLY
extern void main_task(intptr_t exinf);
${roots.map((_,i)=>'extern void lab_task_'+i+'(intptr_t exinf);').join('\n')}
#endif
`;
  const cfg=`/* EV3RTへタスクを登録する設定ファイルです。処理本体はapp.cにあります。 */
INCLUDE("app_common.cfg");
#include "app.h"
DOMAIN(TDOM_APP) {
    /* TA_ACT：アプリの起動時から実行するメインタスクです。 */
    CRE_TSK(MAIN_TASK, { TA_ACT, 0, main_task, TMIN_APP_TPRI, STACK_SIZE, NULL });
${parallel?'    /* 共有データを1タスクずつ扱うためのセマフォです。 */\n    CRE_SEM(LAB_SHARED_SEM, { TA_NULL, 1, 1 });\n'+roots.map((r,i)=>'    '+cComment('lab_task_'+i+'：'+({start:'スタート',condition:'条件成立イベント',changed:'値の変化イベント',message:'メッセージ受信'}[r.kind])+'。TA_NULLは待機状態で作り、main_taskのact_tskで起動します。')+'\n    CRE_TSK(LAB_TASK_'+i+', { TA_NULL, 0, lab_task_'+i+', TMIN_APP_TPRI+1, STACK_SIZE, NULL });').join('\n'):''}
}
ATT_MOD("app.o");
ATT_MOD("ebl_rt_runtime.o");
ATT_MOD("ebl_myblocks.o");
`;
  const readme=`EV3 Block Lab — EV3-RT C source export (prototype)

Target: TOPPERS/EV3RT HRP3, dynamic application SDK. Not HRP2 (time units differ).
${EV3RT_NOTICE}

1. Extract this folder to hrp3/sdk/workspace/${name}/
2. Check ev3_motor_config in app.c against actual L/M motors and sensor wiring.
3. From hrp3/sdk/workspace, run: make app=${name}
4. Copy the generated workspace/app binary to microSD ev3rt/apps/${name}.
5. Boot EV3RT from microSD; use Load App -> SD card -> ${name}.

This ZIP is source code, not a compiled executable. It cannot run as .rbf.
The browser's normal Transfer and Run buttons target standard EV3 firmware only.
The app workbench can compile and transfer through the Windows companion.
Source ZIP export alone does not compile the program.
Read app.c first for starts, events and task supervision.
ebl_myblocks.c contains user-defined My Block functions; ebl_myblocks.h declares them.
ebl_rt_runtime.c contains helpers and the single shared-state definitions.
ebl_rt_runtime.h contains types, extern declarations and helper function prototypes.
Compile all three .c files separately and link their objects together, as configured in Makefile.inc and app.cfg.
Keep all generated files together from the same export. Do not include .c files inside other .c files.
The generated C has not been verified on physical EV3 hardware.
BACK stops the generated application. Normal completion stops configured motors.
${parallel?'Native HRP3 tasks: one worker per start/event (maximum 16), plus a shutdown supervisor.\nEvents are sampled every 20 ms after each handler; handlers do not overlap.\nMessage generations coalesce while a handler is busy. Send-and-wait waits for all receivers.\nListeners keep running after start tasks complete. programEnd or BACK stops all workers.\nShared numerical updates are serialized. Concurrent drive commands to the same motor stop the application.\nAn explicit stop cancels an in-flight finite movement; that task then continues.':''}
Independent finite moves use encoder feedback with generated profiles.
Native synchronized pairs use ev3_motor_steer. Continuous commands use set_power on L/M.
The HRP3 driver uses regulated speed for L/M despite that API's name.
Brake/coast use EV3RT. Hold uses a 20ms software encoder controller capped at 20%.
Hold and completion feedback differ from the standard-firmware controller.
Raw L power uses UNREGULATED_MOTOR; raw M power is rejected to preserve its type.
Individual speed changes during native sync, or reversing an active finite move, stop the app.
Angle motion times out after 180 seconds. Counts are relative to their starting position.
Variables are floats; calculations are checked for nonfinite values.
Sensor ports are configured before execution. Motors default to L unless selected as M.
Strings: UTF-8 120 bytes; 16 text variables and 16 numeric lists of 1000 items.
PID uses seconds, first/stale samples use P only, output is not clamped.
CSV files: SD root /EBL_${name}_<log>.csv, 5000 rows, shared active log.
Numeric display uses generated dot glyphs, not the standard firmware font.
LED flash is generated software timing; smooth pulse is unavailable through the public API.
Unsupported blocks cause export to fail, never silently disappear.
Scope and differences: see docs/ev3rt-export.md in the application repository.
Official reference: https://toppers.jp/trac_user/ev3pf/wiki/WhatsEV3RT
`;
  const files={'app.c':source,'ebl_myblocks.c':myblocksSource,'ebl_myblocks.h':myblocksHeader,'ebl_rt_runtime.h':runtime,'ebl_rt_runtime.c':runtimeSource,'app.h':appHeader,'app.cfg':cfg,'Makefile.inc':'# マイブロック・補助処理を別々にコンパイルしてリンクします。\nAPPL_COBJS += ebl_myblocks.o ebl_rt_runtime.o\nAPPL_LIBS += -lm\n','README.txt':readme,'CODE_GUIDE.txt':CODE_GUIDE,'program-ir.json':JSON.stringify(program,null,2)+'\n'};
  return {name,files:Object.fromEntries(Object.entries(files).map(([f,s])=>[name+'/'+f,s])),notice:EV3RT_NOTICE};
}
