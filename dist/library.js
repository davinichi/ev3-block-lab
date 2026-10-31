// 編集ファイルとマイブロック集の検証・結合を担当する。EV3用RBFの生成や通信は行わない。
// 独自ブロックを追加したときは、この許可一覧にも型名を登録して保存ファイルから復元できるようにする。
const isDefinition=b=>['procedures_defnoreturn','procedures_defreturn'].includes(b?.type);
const types=new Set(['add','sub','mul','div','lt','eq','gt','lte','gte','neq','and','or'].map(op=>'ev3_op_'+op));
for(const type of ['procedures_defreturn','procedures_callreturn','ev3_return_value','ev3_movement_setup','ev3_battery_voltage','ev3_battery_current','ev3_pid','ev3_pid_reset'])types.add(type);
for(const type of ['ev3_when_condition','ev3_when_changed','ev3_when_message','ev3_message_send','ev3_message_wait'])types.add(type);
// 本体ボタン・終了命令も、作品ファイルとマイブロック集の両方から復元できるよう許可する。
for(const type of ['ev3_brick_button','ev3_brick_button_value','ev3_program_end','ev3_myblock_return'])types.add(type);
for(const type of ['ev3_tank','ev3_pivot_right','ev3_pivot_left','ev3_ramp','ev3_math_function','ev3_forever','ev3_motor_l_run','ev3_motor_m_run','ev3_color_is','ev3_color_value','ev3_reflected','ev3_reflected_compare','ev3_distance','ev3_distance_compare','ev3_wait_until','ev3_argument','ev3_math','logic_compare','logic_operation','logic_negate','logic_boolean','controls_if','controls_whileUntil','variables_set','math_change','ev3_start','ev3_motor','ev3_motor_m','ev3_motor_m_time','ev3_wait_seconds','ev3_tread','ev3_spin_right','ev3_spin_left','ev3_wheel','ev3_drive_forward','ev3_drive_backward','ev3_tone','ev3_wait','ev3_stop_port','ev3_stop','math_number','variables_get','controls_repeat_ext','procedures_defnoreturn','procedures_callnoreturn'])types.add(type);
for(const kind of ['l','m'])for(const group of ['single','pair'])for(const action of ['run','angle','rotation','time'])types.add('ev3_motor_'+kind+'_'+group+'_'+action);
for(const type of ['ev3_gyro_angle','ev3_gyro_rate','ev3_gyro_compare','ev3_gyro_reset'])types.add(type);
for(const type of ['ev3_timer','ev3_timer_reset','ev3_encoder','ev3_encoder_reset','ev3_touch','ev3_touch_value','ev3_ir_proximity','ev3_ir_compare','ev3_ir_remote','ev3_ir_button','ev3_ir_beacon_detected','ev3_ir_beacon_heading','ev3_ir_beacon_distance'])types.add(type);
for(const type of ['led','led_off','steering_run','steering_angle','steering_time','log_start','log_value','log_end','data_mod','data_random','data_min','data_max','data_clamp','data_round','text','text_get','text_set','text_join','text_length','text_letter','text_contains','text_equal','text_number','text_to_number','list_clear','list_add','list_set','list_delete','list_item','list_length','list_contains','list_stat'])types.add('ev3_'+type);
// 外部ファイルのブロック種類・個数・入れ子の深さを検査する。Blocklyへ読み込む前に呼び出す。
export function inspectBlocks(blocks){
  let count=0;
  function inspect(value,depth=0){
    if(depth>200)throw Error('ブロックの入れ子が深すぎます。');
    if(value && typeof value==='object'){
      if(value.type && !types.has(value.type))throw Error(`未対応のブロック: ${value.type}`);
      if(value.type && ++count>1000)throw Error('ブロックは1000個までです。');
      for(const child of Object.values(value))inspect(child,depth+1);
    }
  }
  inspect(blocks);
}
// 通常変数・引数の参照IDを集め、書き出しや読み込みに必要な変数情報をそろえる。
function references(nodes){
  const ids=new Set();
  function visit(value){
    if(!value||typeof value!=='object')return;
    if(value.fields?.VAR?.id)ids.add(value.fields.VAR.id);
    if(value.extraState?.parameterId)ids.add(value.extraState.parameterId);
    if(isDefinition(value))for(const p of value.extraState?.params??[])if(p.id)ids.add(p.id);
    for(const child of Object.values(value))visit(child);
  }
  visit(nodes);return ids;
}
const definitionName=block=>String(block.fields?.NAME??'').trim();
// 定義だけを取り出して.ev3blocks用データにする。現在の作品を変更しないように複製を返す。
export function createBlockLibrary(state,appVersion){
  const definitions=(state.blocks?.blocks??[]).filter(b=>isDefinition(b));
  if(!definitions.length)throw Error('書き出すマイブロックがありません。');
  inspectBlocks(definitions);
  const refs=references(definitions);
  return {format:'ev3-block-lab-library',version:1,appVersion,definitions:structuredClone(definitions),variables:structuredClone((state.variables??[]).filter(v=>refs.has(v.id)))};
}
// 既存作品を残したまま定義を追加する。同名定義は上書きせずエラーにし、通常の同名変数は共有する。
export function mergeBlockLibrary(current,library,makeId=()=>crypto.randomUUID()){
  if(library?.format!=='ev3-block-lab-library'||library.version!==1||!Array.isArray(library.definitions)||!library.definitions.length||library.definitions.length>32||!Array.isArray(library.variables))throw Error('マイブロックを書き出したファイルを選んでください。');
  inspectBlocks(library.definitions);
  const names=new Set((current.blocks?.blocks??[]).filter(b=>isDefinition(b)).map(b=>definitionName(b).toLocaleLowerCase()));
  for(const definition of library.definitions){
    const name=definitionName(definition),key=name.toLocaleLowerCase();
    if(!isDefinition(definition)||!name)throw Error('マイブロックの定義が不正です。');
    if(names.has(key))throw Error(`同じ名前のマイブロック「${name}」があります。名前を変更してから読み込んでください。`);
    names.add(key);
  }
  if(names.size>32)throw Error('マイブロックは32個まで読み込めます。');
  const merged=structuredClone(current),variables=merged.variables??[],mapping=new Map();
  for(const variable of library.variables){
    if(typeof variable.id!=='string'||!variable.id||typeof variable.name!=='string'||!variable.name||variable.name.length>256||(variable.type??'')!=='')throw Error('マイブロックの変数情報が不正です。');
    if(mapping.has(variable.id))throw Error('変数の識別情報が重複しています。');
    let target=variables.find(v=>v.name===variable.name&&(v.type??'')===(variable.type??''));
    if(!target){target={...variable,id:makeId()};variables.push(target);}
    mapping.set(variable.id,target.id);
  }
  for(const id of references(library.definitions))if(!mapping.has(id))throw Error('引数または変数の情報が不足しています。');
  const imported=structuredClone(library.definitions);
  // 元のブロックIDを持ち込まず、変数・引数の参照先を結合後のIDへ付け替える。
  function remap(value){
    if(!value||typeof value!=='object')return;
    if(types.has(value.type))delete value.id;
    if(value.fields?.VAR?.id)value.fields.VAR.id=mapping.get(value.fields.VAR.id);
    if(value.extraState?.parameterId)value.extraState.parameterId=mapping.get(value.extraState.parameterId);
    if(isDefinition(value))for(const p of value.extraState?.params??[])if(p.id)p.id=mapping.get(p.id);
    for(const child of Object.values(value))remap(child);
  }
  remap(imported);
  // 読み込んだ定義を既存のブロック群の下へ並べ、重なって見失わないようにする。
  const existing=merged.blocks?.blocks??[],bottom=Math.max(0,...existing.map(b=>Number(b.y)||0))+200;
  imported.forEach((block,i)=>{block.x=40+420*(i%2);block.y=bottom+300*Math.floor(i/2);});
  merged.variables=variables;merged.blocks={...(merged.blocks??{}),languageVersion:0,blocks:[...existing,...imported]};
  inspectBlocks(merged.blocks);return merged;
}

for(const type of ['ev3_motor_speed_set','ev3_motor_power','ev3_motor_stop_mode','ev3_motor_speed','ev3_tank_angle','ev3_tank_time'])types.add(type);

// 直接停止のブロックも作品・マイブロックの読み込みで許可する。
types.add('ev3_motor_stop');

for(const kind of ['clear','text','image','number'])types.add('ev3_display_'+kind);
