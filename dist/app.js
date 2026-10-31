import {compile,EV3Connection,hex,programFileName,projectDirectory} from './ev3.js'; import {inspectBlocks,createBlockLibrary,mergeBlockLibrary} from './library.js'; import {sensorReading} from './sensor-monitor.js'; import {DISPLAY_IMAGES,presetBitmap,rasterDisplayText} from './display.js';
// 画面とBlocklyを結び付ける入口。ブロック定義 → 中間データ → ev3.jsでRBF生成 → 接続・転送の順に処理する。
// 外部ライブラリのdist/vendorは編集せず、独自ブロックと画面側の振る舞いをここに記述する。
const $=id=>document.getElementById(id);
// 自動保存はこのブラウザのlocalStorageに1作品分を保存する。クラウドやGitHubへの保存ではない。
const STORAGE='ev3-block-lab-v1';
const VERSION='0.23.4';
document.querySelector('.badge').textContent=`PROTOTYPE ${VERSION}`;
Blockly.Msg.PROCEDURES_DEFNORETURN_PROCEDURE='マイブロック';
Blockly.Msg.PROCEDURES_DEFNORETURN_TITLE='定義';
Blockly.Msg.CONTROLS_IF_MSG_THEN='';
Blockly.Msg.CONTROLS_IF_MSG_ELSE='';
Blockly.Msg.CONTROLS_IF_MSG_ELSEIF='でなければ、もし';
Blockly.Msg.CONTROLS_REPEAT_INPUT_DO='';
Blockly.Msg.PROCEDURES_CALLNORETURN_TOOLTIP='マイブロックを呼び出します。';
const originalCallInit=Blockly.Blocks.procedures_callnoreturn.init;
Blockly.Blocks.procedures_callnoreturn.init=function(){
  originalCallInit.call(this);
  this.setInputsInline(true);
};
const deviceNames={7:'Lモーター',8:'Mモーター',16:'EV3 タッチセンサ',29:'EV3 カラーセンサ',30:'EV3 超音波センサ',32:'EV3 ジャイロセンサ',33:'EV3 赤外線センサ'};
const deviceName=type=>deviceNames[type]??([0,125,126,127].includes(type)?'未接続／認識中':'未対応機器（種類 '+type+'）');
// 出力ポートの選択値はA=1、B=2、C=4、D=8のビットマスク。2個の指定は値を足したもの。
const singlePorts=[['A','1'],['B','2'],['C','4'],['D','8']];
const pairPorts=[['B + C','6'],['A + B','3'],['A + C','5'],['A + D','9'],['B + D','10'],['C + D','12']];
Blockly.defineBlocksWithJsonArray([
 {type:'ev3_movement_setup',message0:'動きに使うモーターを 左 %1 右 %2 にする',args0:[{type:'field_dropdown',name:'LEFT_PORT',options:[singlePorts[1],singlePorts[0],singlePorts[2],singlePorts[3]]},{type:'field_dropdown',name:'RIGHT_PORT',options:[singlePorts[2],singlePorts[0],singlePorts[1],singlePorts[3]]}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#ff4ccd',tooltip:'実行した時点から全処理・マイブロックで共有します。同じポートは選べません。設定だけでは回りません。変更時は以前の左右組を停止します。'},
 {type:'ev3_start',message0:'▶ スタート',nextStatement:null,colour:'#d3a238',tooltip:'EV3本体から起動すると、ここから実行します。複数置くと別々に並行して動きます。全部のスタートが終わると停止します。イベントがある場合はプログラム終了まで監視を続けます。'},
 {type:'ev3_motor',message0:'Lモーター %1 速さ %2 ％で %3 度回す',args0:[{type:'field_dropdown',name:'PORTS',options:[singlePorts[1],singlePorts[0],singlePorts[2],singlePorts[3],...pairPorts]},{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'DEGREES',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'速度は-100〜100（0以外）。2ポートを選んだ場合の制御方式は「先生用の設定・計測」で選択します。標準は各モーターの指定角度を優先し、同期方式は検証用です。'},
 {type:'ev3_tone',message0:'音 %1 Hz を %2 ミリ秒 鳴らす 音量 %3',args0:[{type:'input_value',name:'FREQUENCY',check:'Number'},{type:'input_value',name:'MS',check:'Number'},{type:'field_number',name:'VOLUME',value:25,min:0,max:100,precision:1}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#a570b3'},
 {type:'ev3_wait',message0:'%1 ミリ秒 待つ（旧形式）',args0:[{type:'input_value',name:'MS',check:'Number'}],previousStatement:null,nextStatement:null,colour:'#d19636'},
 {type:'ev3_stop_port',message0:'モーター %1 を %2 で停止',args0:[{type:'field_dropdown',name:'PORTS',options:[...singlePorts,...pairPorts,['すべて','15']]},{type:'field_dropdown',name:'STOP_MODE',options:[['「動作後の停止方法」の設定','default'],['ブレーキ','brake'],['惰性','coast'],['保持','hold']]}],previousStatement:null,nextStatement:null,colour:'#0090f5',tooltip:'選んだポートだけを停止。ブレーキは100ms制動後に解放、惰性はすぐ解放、保持は停止位置を保ちます。保持はプログラム実行中だけ有効です。旧作品用。「動作後の停止方法」の設定は、先に実行した「モーター…の動作後の停止方法を…にする」を参照します。設定がない場合は従来の標準FWの制動です。'},
 {type:'ev3_stop',message0:'すべてのモーターを停止',previousStatement:null,nextStatement:null,colour:'#0090f5'}
]);

Blockly.defineBlocksWithJsonArray([
 ...[['l','L', [...pairPorts,...singlePorts]],['m','M',[...singlePorts,...pairPorts]]].map(([kind,label,ports])=>({type:'ev3_motor_'+kind+'_run',message0:label+'モーター %1 を速さ %2 ％で回し続ける',args0:[{type:'field_dropdown',name:'PORTS',options:ports},{type:'input_value',name:'SPEED',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'速さは−100〜100％。負の値は逆回転、0は停止。回転を始めたらすぐ次のブロックへ進み、停止の命令またはプログラム終了まで回ります。'})),
 {type:'ev3_math',message0:'%1 %2 %3',args0:[{type:'input_value',name:'A',check:'Number'},{type:'field_dropdown',name:'OP',options:[['＋','add'],['−','sub'],['×','mul'],['÷','div']]},{type:'input_value',name:'B',check:'Number'}],output:'Number',inputsInline:true,colour:'#668b6d'},
 {type:'ev3_motor_m',message0:'Mモーター %1 速さ %2 ％で %3 度回す',args0:[{type:'field_dropdown',name:'PORTS',options:[...singlePorts,...pairPorts]},{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'DEGREES',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5'},
 {type:'ev3_motor_m_time',message0:'Mモーター %1 速さ %2 ％で %3 秒動かす',args0:[{type:'field_dropdown',name:'PORTS',options:[...singlePorts,...pairPorts]},{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'SECONDS',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'時間は0より大きく60秒以下。速さを負にすると逆回転します。2ポートは同時に指定時間だけ動かします。角度の同期・停止タイミング補正は角度指定のブロックを使ってください。'},
 {type:'ev3_wait_seconds',message0:'%1 秒待つ',args0:[{type:'input_value',name:'SECONDS',check:'Number'}],previousStatement:null,nextStatement:null,colour:'#d19636',tooltip:'0〜60秒。0.5秒などの小数も使えます。'},
 {type:'ev3_tread',message0:'トレッド（タイヤ中心どうしの間隔）を %1 mm にする',args0:[{type:'field_number',name:'TREAD',value:112,min:10,max:1000,precision:.1}],previousStatement:null,nextStatement:null,colour:'#ff4ccd',tooltip:'走行・旋回の前に設定します。設定用のマイブロックにまとめることもできます。左右のタイヤ中心間の距離を測ります。'},
 ...[['right','右'],['left','左']].map(([direction,label])=>({type:'ev3_spin_'+direction,message0:'速さ %1 ％で '+label+'に %2 度スピンターン',args0:[{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'ANGLE',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#ff4ccd',tooltip:'ロボットの回転角度を指定。右回転は左輪が正転・右輪が逆転、左回転は反対です。タイヤはLモーター直結を想定します。'})),
 ...[['right','右'],['left','左']].map(([direction,label])=>({type:'ev3_pivot_'+direction,message0:'速さ %1 ％で '+label+'に %2 度ピボットターン',args0:[{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'ANGLE',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#ff4ccd',tooltip:'ロボットの旋回角度を指定。右旋回は右輪をブレーキ停止して左輪を正転、左旋回は左輪を停止して右輪を正転。タイヤ直径・トレッドを先に設定。モーター角度＝2×トレッド÷タイヤ直径×旋回角度。タイヤ直結のLモーターを想定します。'})),
 {type:'ev3_tank',message0:'左の速さ %1 ％ 右の速さ %2 ％で回し続ける',args0:[{type:'input_value',name:'LEFT_SPEED',check:'Number'},{type:'input_value',name:'RIGHT_SPEED',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#ff4ccd',tooltip:'左右それぞれ−100〜100％の速度を直接指定。負は逆転、0はその側のブレーキ停止。L/M共通。回し始めたら次の命令へ進み、停止命令や次のモーター命令まで続けます。後ろに待つ・条件待ち・繰り返しをつなぎます。加減速や角度同期は行いません。'},
 {type:'ev3_wheel',message0:'タイヤの直径を %1 mm にする',args0:[{type:'field_number',name:'DIAMETER',value:56,min:10,max:200,precision:.1}],previousStatement:null,nextStatement:null,colour:'#ff4ccd',tooltip:'走行前に設定します。設定用マイブロックにも入れられます。タイヤをLモーターに直接取り付ける場合の直径です。'},
 ...[['forward','前に進む'],['backward','後ろに下がる']].map(([direction,label])=>({type:'ev3_drive_'+direction,message0:'速さ %1 ％で %2 cm '+label,args0:[{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'CM',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#ff4ccd',tooltip:'先頭にタイヤの直径を設定。速さ1〜100％、長さは正の整数。タイヤ直結・両輪の正回転が前進する取り付けを想定します。'}))
]);


Blockly.defineBlocksWithJsonArray([{type:'ev3_ramp',message0:'加減速を %1 にする 加速 %2 秒 減速 %3 秒',args0:[{type:'field_dropdown',name:'MODE',options:[['台形','trapezoid'],['S字','scurve'],['なし','off']]},{type:'input_value',name:'UP',check:'Number'},{type:'input_value',name:'DOWN',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'後ろのL/Mモーターの角度・時間指定と走行・旋回に適用。0〜10秒。設定用マイブロックにも入れられます。回し続ける・停止ブロックは対象外。角度指定は停止位置を優先し、短い移動では指定速度に届かないことがあります。20ミリ秒ごとに速度指令を更新する試作機能です。'}]);

// New classroom palette separates one motor from a pair. Keep legacy types
// above unchanged so earlier saved projects retain their port choices.
const classroomMotorBlocks=[];
for(const [kind,label] of [['l','L'],['m','M']])for(const paired of [false,true])for(const action of ['run','angle','rotation','time']){
 const type='ev3_motor_'+kind+'_'+(paired?'pair':'single')+'_'+action;
 const ports=paired?pairPorts:kind==='l'?[singlePorts[1],singlePorts[0],singlePorts[2],singlePorts[3]]:singlePorts;
 const suffix={run:'を速さ %2 ％で回し続ける',angle:'速さ %2 ％で %3 度回す',rotation:'速さ %2 ％で %3 回転する',time:'速さ %2 ％で %3 秒動かす'}[action];
 const tooltip=action==='run'?'速さ−100〜100％。負は逆転、0は停止。回し始めたら次の命令へ進みます。':action==='time'?'時間は0より大きく60秒以下。0.5秒なども使えます。速さは−100〜100％で0以外。':'速さは−100〜100％で0以外。指定角度まで回してから次の命令へ進みます。';
 classroomMotorBlocks.push({type,message0:label+'モーター'+(paired?'2個':'1個')+' %1 '+suffix,args0:[{type:'field_dropdown',name:'PORTS',options:ports},{type:'input_value',name:'SPEED',check:'Number'},...(action==='run'?[]:[{type:'input_value',name:action==='angle'?'DEGREES':action==='rotation'?'ROTATIONS':'SECONDS',check:'Number'}])],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:tooltip+(paired?(action==='angle'?' 同期・停止タイミング補正の方式は「先生用の設定・計測」で選べます。':' 2個を同時に同じ速さの指定で始動します。角度同期の補正はしません。'):'')});
}
Blockly.defineBlocksWithJsonArray(classroomMotorBlocks);
// L/Mそれぞれを単独・2個に分け、連続回転／角度／時間を同じ順番で表示する。
function classroomMotorToolbox(){
 const items=[{kind:'label',text:'加速・減速（L・M共通）'},{kind:'block',type:'ev3_ramp',inputs:{UP:shadow(.5),DOWN:shadow(.5)}}];
 for(const [kind,label] of [['l','L'],['m','M']])for(const paired of [false,true]){
  items.push({kind:'label',text:label+'モーター '+(paired?'2個（同期・同時）':'1個')});
  for(const action of ['run','angle','rotation','time'])items.push({kind:'block',type:'ev3_motor_'+kind+'_'+(paired?'pair':'single')+'_'+action,inputs:{SPEED:shadow(20),...(action==='angle'?{DEGREES:shadow(90)}:action==='rotation'?{ROTATIONS:shadow(1)}:action==='time'?{SECONDS:shadow(1)}:{})}});
 }
 return [...items,{kind:'label',text:'L・M共通の速度・パワー・停止方法'},{kind:'block',type:'ev3_motor_speed_set',inputs:{SPEED:shadow(20)}},{kind:'block',type:'ev3_motor_power',inputs:{POWER:shadow(20)}},{kind:'block',type:'ev3_motor_stop_mode'},{kind:'label',text:'モーターを停止（L・M共通）'},{kind:'block',type:'ev3_motor_stop'},{kind:'block',type:'ev3_stop'}];
}

// 速度調整（閉ループ）とパワー（出力率固定）を別のブロックとして示す。
const stopOptions=[['ブレーキ','brake'],['惰性','coast'],['保持','hold']];
const commonMotorPorts=()=>({type:'field_dropdown',name:'PORTS',options:[...singlePorts,...pairPorts,['すべて','15']]});
Blockly.defineBlocksWithJsonArray([
 {type:'ev3_motor_speed_set',message0:'モーター %1 の速さを %2 ％にする',args0:[commonMotorPorts(),{type:'input_value',name:'SPEED',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'L/M共通。動作中の速度を変更します。このブロックだけでは停止中のモーターを始動しません。角度制御中は目標角度を保ちます。速さは−100〜100％。'},
 {type:'ev3_motor_power',message0:'モーター %1 をパワー %2 ％で回し続ける',args0:[commonMotorPorts(),{type:'input_value',name:'POWER',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'L/M共通。−100〜100％の出力率を固定し、速さの自動調整を行いません。同じ値でも負荷により回転速度が変わります。負は逆転、0は出力0。停止や条件待ちと組み合わせます。'},
 // 新しい停止ブロックは方法を直接選択。旧形式は保存済み作品の動作を保つため残す。
 {type:'ev3_motor_stop',message0:'モーター %1 を %2 で停止',args0:[commonMotorPorts(),{type:'field_dropdown',name:'STOP_MODE',options:stopOptions}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'選んだポートを、ここで選んだ方法ですぐ停止します。ブレーキ：100ミリ秒制動後に力を抜く。惰性：すぐ力を抜く。保持：停止位置を保つ（プログラム実行中のみ）。動作後の停止方法の設定には依存しません。'},
 {type:'ev3_motor_stop_mode',message0:'モーター %1 の動作後の停止方法を %2 にする',args0:[commonMotorPorts(),{type:'field_dropdown',name:'MODE',options:stopOptions}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'この後の角度・回転数・時間・距離・旋回の完了時に適用します。直接停止するブロックでは、そのブロックで選んだ停止方法を使います。旧作品の「動作後の停止方法」の設定を使う停止にも適用します。同期走行の2ポートは同じ設定にしてください。保持は本体でプログラムを終了すると解除されます。'},
 {type:'ev3_motor_speed',message0:'モーター %1 の実際の速さ（％）',args0:[{type:'field_dropdown',name:'PORT',options:singlePorts.map(([label],i)=>[label,String(i+1)])}],output:'Number',colour:'#34ccf1',tooltip:'L/M共通。設定した速さではなく、本体が測定した現在の回転速度を−100〜100％で返します。逆回転は負になります。'},
 ...['angle','time'].map(action=>({type:'ev3_tank_'+action,message0:'左の速さ %1 ％ 右の速さ %2 ％で '+(action==='angle'?'速い側を %3 度回す':'%3 秒走る'),args0:[{type:'input_value',name:'LEFT_SPEED',check:'Number'},{type:'input_value',name:'RIGHT_SPEED',check:'Number'},{type:'input_value',name:action==='angle'?'DEGREES':'SECONDS',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#ff4ccd',tooltip:'同じ種類の2モーターで使います。左右−100〜100％、両方0は使えません。指定量が終わるまで待ちます。角度は速い側のモーター軸が基準。左右の回転量は速度比に応じて変わります。標準FWの比率は約1％刻み。加減速設定は適用しません。'}))
]);

// 入力センサのポート番号は1〜4。モーター出力のビットマスクとは別の番号体系。
const sensorPorts=[['1','1'],['2','2'],['3','3'],['4','4']];
const brickButtons=[['中央','2'],['上','1'],['下','3'],['左','5'],['右','4'],['いずれか','7']];
const colorNames=[['赤','5'],['黒','1'],['青','2'],['緑','3'],['黄','4'],['白','6'],['茶','7'],['色なし','0']];
const sensorPort=()=>({type:'field_dropdown',name:'PORT',options:sensorPorts});
const comparison=()=>({type:'field_dropdown',name:'OP',options:[['＜','lt'],['＝','eq'],['＞','gt'],['≦','lte'],['≧','gte'],['≠','neq']]});
Blockly.defineBlocksWithJsonArray([
 // ジャイロは角度・回転速度を同じ複合モードで取得し、並行計測時の切替を避ける。
 {type:'ev3_gyro_angle',message0:'ジャイロセンサ %1 の角度（度）',args0:[sensorPort()],output:'Number',colour:'#34ccf1',tooltip:'現在の回転角度。逆方向は負になります。角度を0にするブロック以降は、その向きからの角度を返します。取付方向で符号が変わります。'},
 {type:'ev3_gyro_rate',message0:'ジャイロセンサ %1 の回転速度（度／秒）',args0:[sensorPort()],output:'Number',colour:'#34ccf1',tooltip:'1秒あたりの回転角度。逆方向は負です。角度と同時に使っても測定モードは切り替えません。'},
 {type:'ev3_gyro_compare',message0:'ジャイロセンサ %1 の %2 が %3 %4',args0:[sensorPort(),{type:'field_dropdown',name:'MEASURE',options:[['角度（度）','gyroAngle'],['回転速度（度／秒）','gyroRate']]},comparison(),{type:'input_value',name:'VALUE',check:'Number'}],output:'Boolean',inputsInline:true,colour:'#34ccf1',tooltip:'角度または回転速度を指定値と比較します。「まで待つ」「もし」「イベント」の条件に使えます。'},
 {type:'ev3_gyro_reset',message0:'ジャイロセンサ %1 の角度を0にする',args0:[sensorPort()],previousStatement:null,nextStatement:null,colour:'#34ccf1',tooltip:'現在の向きをこのプログラム内の0度にします。ゼロ点は同じポートを使う全処理で共有します。センサ本体の再校正ではなく、接続中のポート表示の生値は変わりません。静止した状態で実行してください。'},
 {type:'ev3_battery_voltage',message0:'EV3本体のバッテリー電圧（V）',output:'Number',colour:'#34ccf1',tooltip:'本体が測定したバッテリー全体の電圧をV単位の小数で返します。残量の％ではありません。'},
 {type:'ev3_battery_current',message0:'EV3本体のバッテリー電流（A）',output:'Number',colour:'#34ccf1',tooltip:'本体が測定したバッテリー全体の消費電流をA単位の小数で返します。モーター1個ごとの電流ではありません。'},
 {type:'ev3_pid',message0:'PID %1 目標値 %2 測定値 %3',args0:[{type:'field_input',name:'NAME',text:'PID1'},{type:'input_value',name:'TARGET',check:'Number'},{type:'input_value',name:'MEASURED',check:'Number'}],message1:'kp %1 ki %2 kd %3 の出力',args1:[{type:'input_value',name:'KP',check:'Number'},{type:'input_value',name:'KI',check:'Number'},{type:'input_value',name:'KD',check:'Number'}],output:'Number',inputsInline:true,colour:'#00b85d',tooltip:'目標値−測定値の偏差と実際の経過秒数でPIDを計算。同じ名前は状態を共有します。初回はP項のみ。同じ1ms内は前回出力。出力制限はないので必要な範囲に収めて使います。'},
 {type:'ev3_pid_reset',message0:'PID %1 をリセットする',args0:[{type:'field_input',name:'NAME',text:'PID1'}],previousStatement:null,nextStatement:null,colour:'#d19636',tooltip:'同じ名前のPIDの積分・前回偏差・時刻を消します。次の計算はP項のみ。モーターを動かしたり停止したりする命令ではありません。'},
 {type:'ev3_color_is',message0:'カラーセンサ %1 の色が %2',args0:[sensorPort(),{type:'field_dropdown',name:'COLOR',options:colorNames}],output:'Boolean',inputsInline:true,colour:'#34ccf1',tooltip:'EV3カラーセンサ。選んだ色なら成り立ちます。'},
 {type:'ev3_color_value',message0:'カラーセンサ %1 の色（番号）',args0:[sensorPort()],output:'Number',colour:'#34ccf1',tooltip:'0:色なし、1:黒、2:青、3:緑、4:黄、5:赤、6:白、7:茶。'},
 {type:'ev3_reflected',message0:'カラーセンサ %1 の反射光（％）',args0:[sensorPort()],output:'Number',colour:'#34ccf1',tooltip:'0〜100％。反射する光の強さを読みます。'},
 {type:'ev3_reflected_compare',message0:'カラーセンサ %1 の反射光が %2 %3 ％',args0:[sensorPort(),comparison(),{type:'input_value',name:'VALUE',check:'Number'}],output:'Boolean',inputsInline:true,colour:'#34ccf1'},
 {type:'ev3_distance',message0:'超音波センサ %1 の距離（cm）',args0:[sensorPort()],output:'Number',colour:'#34ccf1',tooltip:'EV3超音波センサ。cmの小数部分は切り捨てます。'},
 {type:'ev3_distance_compare',message0:'超音波センサ %1 の距離が %2 %3 cm',args0:[sensorPort(),comparison(),{type:'input_value',name:'VALUE',check:'Number'}],output:'Boolean',inputsInline:true,colour:'#34ccf1'},
 {type:'ev3_forever',message0:'ずっと',message1:'%1',args1:[{type:'input_statement',name:'DO'}],previousStatement:null,colour:'#d19636',tooltip:'中の命令を終わりなく繰り返します。センサは周回ごとに読み直します。EV3本体の戻るボタンでプログラムを停止してください。'},
 {type:'ev3_wait_until',message0:'%1 まで待つ',args0:[{type:'input_value',name:'BOOL',check:'Boolean'}],previousStatement:null,nextStatement:null,colour:'#d19636',tooltip:'条件が成り立つまで、EV3本体で繰り返し確認します。'}
]);


const irChannel=()=>({type:'field_dropdown',name:'CHANNEL',options:[['1','1'],['2','2'],['3','3'],['4','4']]});
const irButtons=[['押されていない','0'],['左上','1'],['左下','2'],['右上','3'],['右下','4'],['左上＋右上','5'],['左上＋右下','6'],['左下＋右上','7'],['左下＋右下','8'],['ビーコン','9'],['左上＋左下','10'],['右上＋右下','11']];
Blockly.defineBlocksWithJsonArray([
 {type:'ev3_brick_button',message0:'本体の %1 ボタンが %2',args0:[{type:'field_dropdown',name:'BUTTON',options:brickButtons},{type:'field_dropdown',name:'STATE',options:[['押されている','1'],['離されている','0']]}],output:'Boolean',inputsInline:true,colour:'#34ccf1',tooltip:'現在のボタンの状態を判定します。押した瞬間を記憶する機能ではありません。「いずれか」は上下左右・中央が対象です。戻るボタンは本体の停止操作に使います。'},
 {type:'ev3_brick_button_value',message0:'本体の %1 ボタンの値（0／1）',args0:[{type:'field_dropdown',name:'BUTTON',options:brickButtons}],output:'Number',colour:'#34ccf1',tooltip:'押されていれば1、離されていれば0。上下左右・中央に対応します。'},
 {type:'ev3_timer',message0:'タイマー（秒）',output:'Number',colour:'#34ccf1',tooltip:'プログラム開始または最後のリセットからの経過秒数。0.5秒などの小数で取得します。すべてのマイブロックで同じタイマーを使います。'},
 {type:'ev3_timer_reset',message0:'タイマーをリセット',previousStatement:null,nextStatement:null,colour:'#34ccf1',tooltip:'タイマーを0秒に戻します。モーターや待ち時間の制御は変更しません。'},
 {type:'ev3_encoder_reset',message0:'モーター %1 の回転角度を0にする',args0:[{type:'field_dropdown',name:'PORT',options:singlePorts.map(([label],i)=>[label,String(i+1)])}],previousStatement:null,nextStatement:null,colour:'#34ccf1',tooltip:'L・M共通。選んだポートのエンコーダだけを0に戻します。ほかのポートの角度や、回転・停止の状態は変えません。'},
 {type:'ev3_encoder',message0:'モーター %1 の回転角度（度）',args0:[{type:'field_dropdown',name:'PORT',options:singlePorts.map(([label],i)=>[label,String(i+1)])}],output:'Number',colour:'#34ccf1',tooltip:'L・M共通のエンコーダ値。符号付きの累積角度で、0〜359には折り返しません。読み取りでリセットはしません。開始値を変数に記録し、現在値から引くと今回の回転量になります。'},
 {type:'ev3_touch',message0:'タッチセンサ %1 が %2',args0:[sensorPort(),{type:'field_dropdown',name:'STATE',options:[['押された','1'],['離された','0']]}],output:'Boolean',inputsInline:true,colour:'#34ccf1',tooltip:'EV3タッチセンサの現在の状態を判定します。押した瞬間を記憶する機能ではありません。'},
 {type:'ev3_touch_value',message0:'タッチセンサ %1 の値（0／1）',args0:[sensorPort()],output:'Number',colour:'#34ccf1',tooltip:'押されていれば1、離れていれば0。'},
 {type:'ev3_ir_proximity',message0:'赤外線センサ %1 の近さ（0〜100）',args0:[sensorPort()],output:'Number',colour:'#34ccf1',tooltip:'0が近く、100が遠い相対値。cmではありません。'},
 {type:'ev3_ir_compare',message0:'赤外線センサ %1 の近さが %2 %3',args0:[sensorPort(),comparison(),{type:'input_value',name:'VALUE',check:'Number'}],output:'Boolean',inputsInline:true,colour:'#34ccf1'},
 {type:'ev3_ir_remote',message0:'赤外線センサ %1 チャンネル %2 のボタン番号',args0:[sensorPort(),irChannel()],output:'Number',inputsInline:true,colour:'#34ccf1',tooltip:'0:なし、1:左上、2:左下、3:右上、4:右下、5〜8:左右の組合せ、9:ビーコン、10:左上下、11:右上下。'},
 {type:'ev3_ir_button',message0:'赤外線センサ %1 チャンネル %2 のボタンが %3',args0:[sensorPort(),irChannel(),{type:'field_dropdown',name:'BUTTON',options:irButtons}],output:'Boolean',inputsInline:true,colour:'#34ccf1',tooltip:'選んだボタンの組合せに一致するかを判定します。'},
 ...[['detected','を検出している','Boolean'],['heading','の方向（−25〜25）','Number'],['distance','までの近さ（0〜100）','Number']].map(([kind,label,output])=>({type:'ev3_ir_beacon_'+kind,message0:'赤外線センサ %1 チャンネル %2 のビーコン'+label,args0:[sensorPort(),irChannel()],output,inputsInline:true,colour:'#34ccf1',tooltip:'ビーコンモードをオンにして使います。方向は負が左、0が正面、正が右の相対値。距離はcmではありません。未検出なら検出条件は偽、方向0、近さ100です。数値を使う前に検出条件で確かめてください。'}))
]);
// Keep existing block types and input names so saved lessons retain their wiring.
// 制御ブロックの見た目を調整する層。既存作品を読み込めるよう、保存上の型名と入力名は保つ。
const controlColour='#f5a400';
Blockly.defineBlocksWithJsonArray([
 {type:'ev3_program_end',message0:'プログラムを終了する',previousStatement:null,colour:controlColour,tooltip:'すべてのモーターをブレーキ停止し、プログラム全体を終了します。繰り返しやマイブロックの中からでも終了します。'},
 {type:'ev3_myblock_return',message0:'このマイブロックを終了する',previousStatement:null,colour:controlColour,tooltip:'このマイブロックの残りの命令を実行せず、呼び出し元の次の命令へ進みます。モーターは停止しません。マイブロックの定義の中だけで使えます。'}
]);
function controlFooter(block){
 if(!block.getInput('EV3_LOOP_ICON'))block.appendDummyInput('EV3_LOOP_ICON').setAlign(Blockly.inputs.Align.RIGHT).appendField('↻');
}
// 「でなければ」は2つの処理欄の間の仕切りに置き、処理欄の横位置をそろえる。
function controlIfShape(block){
 block.setColour(controlColour);block.setInputsInline(true);
 for(let i=0;block.getInput('IF'+i);i++){
   const name='EV3_THEN_'+i;
   if(!block.getInput(name)){block.appendDummyInput(name).appendField('なら');block.moveInputBefore(name,'DO'+i);}
 }
 // The else label belongs on the divider, above the second statement cavity.
 // A label on the ELSE statement itself shifts both cavities to the right.
 if(block.getInput('ELSE')&&!block.getInput('EV3_ELSE_LABEL')){
   block.appendDummyInput('EV3_ELSE_LABEL').setAlign(Blockly.inputs.Align.LEFT).appendField('でなければ');
   block.moveInputBefore('EV3_ELSE_LABEL','ELSE');
 }
}
const controlIfInit=Blockly.Blocks.controls_if.init;
Blockly.Blocks.controls_if.init=function(){
 controlIfInit.call(this);
 // Offer the two fixed forms in the palette; retain serialization for old lessons.
 this.setMutator(null);
 const update=this.updateShape_;
 this.updateShape_=function(){
   for(const input of [...this.inputList])if(input.name.startsWith('EV3_THEN_')||input.name==='EV3_ELSE_LABEL')this.removeInput(input.name);
   update.call(this);controlIfShape(this);
 };
 controlIfShape(this);
};
// Put the condition first and the loop mode after it, as in the reference.
Blockly.Blocks.controls_whileUntil.init=function(){
 this.jsonInit({message0:'%1 %2',args0:[{type:'input_value',name:'BOOL',check:'Boolean'},{type:'field_dropdown',name:'MODE',options:[['まで繰り返す','UNTIL'],['の間繰り返す','WHILE']]}],message1:'%1',args1:[{type:'input_statement',name:'DO'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:controlColour,extensions:['controls_whileUntil_tooltip']});
 controlFooter(this);
};
for(const type of ['controls_repeat_ext','ev3_forever','ev3_wait_until','ev3_wait_seconds','ev3_wait']){
 const init=Blockly.Blocks[type].init;
 Blockly.Blocks[type].init=function(){init.call(this);this.setColour(controlColour);this.setInputsInline(true);if(['controls_repeat_ext','ev3_forever'].includes(type))controlFooter(this);};
}

// 演算の表示を定義する。実際の計算方法と小数の精度はev3.jsの検証・命令生成が担当する。
const operatorColour='#00b84a';
const operatorKinds={add:['＋','Number'],sub:['−','Number'],mul:['×','Number'],div:['÷','Number'],lt:['＜','Boolean'],eq:['＝','Boolean'],gt:['＞','Boolean'],lte:['≦','Boolean'],gte:['≧','Boolean'],neq:['≠','Boolean'],and:['かつ','Boolean'],or:['または','Boolean']};
Blockly.defineBlocksWithJsonArray(Object.entries(operatorKinds).map(([op,[label,output]])=>({
 type:'ev3_op_'+op,message0:'%1 '+label+' %2',args0:[{type:'input_value',name:'A',check:['and','or'].includes(op)?'Boolean':'Number'},{type:'input_value',name:'B',check:['and','or'].includes(op)?'Boolean':'Number'}],output,inputsInline:true,colour:operatorColour,
 tooltip:op==='div'?'小数も計算できます。0では割れません。':'左右に数値・変数・センサや条件を入れられます。'
})));
const numericFunctions=[['絶対値','abs'],['切り下げ','floor'],['切り上げ','ceil'],['平方根','sqrt'],['sin','sin'],['cos','cos'],['tan','tan'],['asin','asin'],['acos','acos'],['atan','atan'],['ln','ln'],['log','log'],['e^','exp'],['10^','pow10']];
Blockly.defineBlocksWithJsonArray([{type:'ev3_math_function',message0:'%1 の %2',args0:[{type:'input_value',name:'VALUE',check:'Number'},{type:'field_dropdown',name:'FUNCTION',options:numericFunctions}],output:'Number',inputsInline:true,colour:operatorColour,tooltip:'数値関数を選びます。三角関数の角度は度。変数・引数と四則演算は常に小数に対応します。'}]);
// Older projects keep their stored operator choices; new palette blocks have
// fixed symbols, so children do not need to change a dropdown after dragging.
for(const type of ['math_number','ev3_math','logic_compare','logic_operation','logic_negate','logic_boolean']){
 const init=Blockly.Blocks[type].init;
 Blockly.Blocks[type].init=function(){init.call(this);this.setColour(operatorColour);this.setInputsInline(true);};
}

// 本体ランプ・ステアリング・記録・データ処理。入力の形で数値と文字列を区別する。
const numberInput=name=>({type:'input_value',name,check:'Number'}),textInput=name=>({type:'input_value',name,check:'String'}),namedField=(name,value)=>({type:'field_input',name,text:value});
const dataColour='#00b85b',stmt={previousStatement:null,nextStatement:null,inputsInline:true};
Blockly.defineBlocksWithJsonArray([
 {type:'ev3_led',message0:'本体のランプを %1 に %2',args0:[{type:'field_dropdown',name:'COLOR',options:[['緑','1'],['赤','2'],['オレンジ','3']]},{type:'field_dropdown',name:'MODE',options:[['点灯','on'],['点滅','flash'],['ゆっくり点滅','pulse']]}],...stmt,colour:'#9966ff',tooltip:'ランプを変えてすぐ次へ進みます。表示を保つには待つ命令などを続けます。終了後は本体の通常表示へ戻ります。'},
 {type:'ev3_led_off',message0:'本体のランプを消す',...stmt,colour:'#9966ff'},
 ...['run','angle','time'].map(action=>({type:'ev3_steering_'+action,message0:'ステアリング %1 速さ %2 ％で '+({run:'回し続ける',angle:'外側を %3 度回す',time:'%3 秒走る'}[action]),args0:[numberInput('TURN'),numberInput('SPEED'),...(action==='run'?[]:[numberInput(action==='angle'?'DEGREES':'SECONDS')])],...stmt,colour:'#ff4ccd',tooltip:'L/M共通。ステアリング−100は左スピン、−50は左ピボット、0は直進、50は右ピボット、100は右スピン。角度は外側のモーター軸の角度です。加減速の設定は適用しません。'})),
 {type:'ev3_log_start',message0:'CSVログ %1 の記録を開始する',args0:[namedField('FILE','Log')],...stmt,colour:'#c58245',tooltip:'EV3のプロジェクトフォルダへ保存。同じログ名は上書き。半角英数字・-・_で31文字以内。1行ごとに閉じて保存します。PCを切り離しても記録できます。'},
 {type:'ev3_log_value',message0:'項目 %1 値 %2 をCSVに記録する',args0:[namedField('LABEL','値'),{type:'input_value',name:'VALUE',check:['Number','String']}],...stmt,colour:'#c58245',tooltip:'記録開始からの秒数・項目名・値を1行記録。変数、演算、センサ、文字列が使えます。1回の開始につき5000行まで。開始してから使ってください。'},
 {type:'ev3_log_end',message0:'CSVログの記録を終了する',...stmt,colour:'#c58245'},
 ...[['mod','%1 を %2 で割った余り'],['random','%1 から %2 までの整数乱数'],['min','%1 と %2 の小さい方'],['max','%1 と %2 の大きい方']].map(([kind,message0])=>({type:'ev3_data_'+kind,message0,args0:[numberInput('A'),numberInput('B')],output:'Number',inputsInline:true,colour:dataColour})),
 {type:'ev3_data_round',message0:'%1 を四捨五入',args0:[numberInput('A')],output:'Number',colour:dataColour,tooltip:'0.5を足して切り下げます。1.5→2、−1.5→−1。'},
 {type:'ev3_data_clamp',message0:'%1 を %2 から %3 の範囲に収める',args0:[numberInput('A'),numberInput('LOW'),numberInput('HIGH')],output:'Number',inputsInline:true,colour:dataColour},
 {type:'ev3_text',message0:'文字列 %1',args0:[namedField('TEXT','こんにちは')],output:'String',colour:dataColour,tooltip:'UTF-8で120バイト以内。日本語は通常40文字以内。'},
 {type:'ev3_text_join',message0:'%1 と %2 をつなぐ',args0:[textInput('A'),textInput('B')],output:'String',inputsInline:true,colour:dataColour},
 {type:'ev3_text_length',message0:'%1 の文字数',args0:[textInput('VALUE')],output:'Number',colour:dataColour,tooltip:'日本語も1文字として数えます。結合文字は別に数えます。'},
 {type:'ev3_text_letter',message0:'%1 の %2 番目の文字',args0:[textInput('VALUE'),numberInput('INDEX')],output:'String',inputsInline:true,colour:dataColour},
 ...[['contains','%1 に %2 が含まれる'],['equal','%1 と %2 が同じ']].map(([op,message0])=>({type:'ev3_text_'+op,message0,args0:[textInput('A'),textInput('B')],output:'Boolean',inputsInline:true,colour:dataColour})),
 {type:'ev3_text_number',message0:'数値 %1 を文字列にする',args0:[numberInput('VALUE')],output:'String',colour:dataColour},
 {type:'ev3_text_to_number',message0:'文字列 %1 を数値にする',args0:[textInput('VALUE')],output:'Number',colour:dataColour,tooltip:'数値として読める文字列を使います。'},
 {type:'ev3_text_set',message0:'文字列変数 %1 を %2 にする',args0:[namedField('NAME','メッセージ'),textInput('VALUE')],...stmt,colour:'#ff8c1a'},
 {type:'ev3_text_get',message0:'%1',args0:[namedField('NAME','メッセージ')],output:'String',colour:'#ff8c1a',tooltip:'同じ名前の文字列変数を共有。プログラム開始時は空文字。数値変数とは別です。'},
 ...[['add','リスト %1 に %2 を追加'],['set','リスト %1 の %2 番目を %3 にする'],['delete','リスト %1 の %2 番目を削除'],['clear','リスト %1 を空にする']].map(([op,message0])=>({type:'ev3_list_'+op,message0,args0:[namedField('LIST','データ'),...(['set','delete'].includes(op)?[numberInput('INDEX')]:[]),...(['set','add'].includes(op)?[numberInput('VALUE')]:[])],...stmt,colour:'#ff8c1a',tooltip:'数値のリスト。名前で共有し、プログラム開始時は空。番号は1から、最大1000項目。'})),
 {type:'ev3_list_item',message0:'リスト %1 の %2 番目',args0:[namedField('LIST','データ'),numberInput('INDEX')],output:'Number',inputsInline:true,colour:'#ff8c1a'},
 {type:'ev3_list_length',message0:'リスト %1 の項目数',args0:[namedField('LIST','データ')],output:'Number',colour:'#ff8c1a'},
 {type:'ev3_list_contains',message0:'リスト %1 に %2 が含まれる',args0:[namedField('LIST','データ'),numberInput('VALUE')],output:'Boolean',inputsInline:true,colour:'#ff8c1a'},
 {type:'ev3_list_stat',message0:'リスト %1 の %2',args0:[namedField('LIST','データ'),{type:'field_dropdown',name:'OP',options:[['合計','sum'],['平均','average'],['最小値','min'],['最大値','max']]}],output:'Number',colour:'#ff8c1a',tooltip:'平均・最小・最大は1項目以上必要です。空の合計は0です。'}
]);

// イベントは開始ブロックと同じく、上につなぐブロックを持たない。
// 条件・値の欄へ既存のセンサや比較ブロックを入れ、監視内容を組み立てる。
Blockly.defineBlocksWithJsonArray([
 {type:'ev3_when_condition',message0:'%1 が成り立ったとき',args0:[{type:'input_value',name:'BOOL',check:'Boolean'}],nextStatement:null,colour:'#d3a238',tooltip:'約20ミリ秒ごとに条件を確認し、成り立たない状態から成り立つ状態になったときに実行します。開始時に成り立っていても1回実行します。実行中の再起動はしません。'},
 {type:'ev3_when_changed',message0:'%1 の値が変わったとき',args0:[{type:'input_value',name:'VALUE',check:'Number'}],nextStatement:null,colour:'#d3a238',tooltip:'センサ・変数などの数値を約20ミリ秒ごとに確認します。開始時の値を基準に、変化すると実行します。実行中は同じ処理を重ねて起動しません。'},
 {type:'ev3_when_message',message0:'%1 を受け取ったとき',args0:[{type:'field_input',name:'MESSAGE',text:'メッセージ1'}],nextStatement:null,colour:'#d3a238',tooltip:'同じ名前のメッセージを送ると起動します。実行中の追加受信はまとめて保持し、完了後に最新分をもう1回実行します。'},
 ...[['send','を送る'],['wait','を送って待つ']].map(([kind,label])=>({type:'ev3_message_'+kind,message0:'%1 '+label,args0:[{type:'field_input',name:'MESSAGE',text:'メッセージ1'}],previousStatement:null,nextStatement:null,colour:'#d3a238',tooltip:kind==='wait'?'同じ名前の受信処理が全部終わるまで待ちます。受信処理がない場合はそのまま進みます。自分や互いの完了を待つ構成は使えません。':'同じ名前の受信処理を起動し、すぐ次へ進みます。名前は大文字・小文字も含めて一致させてください。'}))
]);

// 本体画面の位置は左上が(0,0)。画像と日本語は実行ファイル内に埋め込む。
const screenPosition=()=>[{type:'field_number',name:'X',value:0,min:0,max:177,precision:1},{type:'field_number',name:'Y',value:16,min:0,max:127,precision:1}];
Blockly.defineBlocksWithJsonArray([
 {type:'ev3_display_clear',message0:'本体の画面を消す',previousStatement:null,nextStatement:null,colour:'#9966ff',tooltip:'本体画面全体を白くします。表示したい内容を後ろにつなぎます。'},
 {type:'ev3_display_text',message0:'本体に文字 %1 を表示 横 %2 縦 %3 大きさ %4',args0:[{type:'field_input',name:'TEXT',text:'こんにちは'},...screenPosition(),{type:'field_dropdown',name:'SIZE',options:[['小','12'],['中','16'],['大','24']]}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#9966ff',tooltip:'日本語も使えます。横0〜177・縦0〜127ドット。画面からはみ出す場合は位置・文字数・大きさを変更してください。転送時に文字を画像へ変換するので、本体だけで表示できます。'},
 {type:'ev3_display_image',message0:'本体に画像 %1 を表示 横 %2 縦 %3 大きさ %4',args0:[{type:'field_dropdown',name:'IMAGE',options:DISPLAY_IMAGES},...screenPosition(),{type:'field_dropdown',name:'SIZE',options:[['48ドット','48'],['96ドット','96']]}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#9966ff',tooltip:'顔・ハート・チェック・ばつ・矢印を選びます。画像の位置と大きさを指定。表示部分は白い背景で置き換え、他の部分は残します。外部の画像ファイルは不要です。'},
 {type:'ev3_display_number',message0:'本体に数値 %1 を表示 横 %2 縦 %3 大きさ %4 小数 %5 桁',args0:[{type:'input_value',name:'VALUE',check:'Number'},...screenPosition(),{type:'field_dropdown',name:'FONT',options:[['小','0'],['大','2']]},{type:'field_number',name:'DECIMALS',value:1,min:0,max:3,precision:1}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#9966ff',tooltip:'変数・センサ・演算を差し込めます。数値欄を白くしてから描き直します。数値は符号・小数点を含め先頭10文字まで。大きい数値は桁を確認してください。繰り返しの中で使うと更新されます。'}
]);

const num=(n)=>({kind:'block',type:'math_number',fields:{NUM:n}});
const shadow=(n)=>({shadow:{type:'math_number',fields:{NUM:n}}});
// 左側カテゴリの公開一覧。新規ブロック追加時は、定義・chain/expression・library.jsの許可一覧も確認する。
const toolbox={kind:'categoryToolbox',contents:[
 {kind:'category',name:'スタート',colour:'#d3a238',contents:[{kind:'block',type:'ev3_start'}]},
 {kind:'category',name:'モーター',colour:'#0090f5',contents:classroomMotorToolbox()},
 {kind:'category',name:'動き',colour:'#ff4ccd',contents:[{kind:'block',type:'ev3_wheel'},{kind:'block',type:'ev3_tread'},{kind:'block',type:'ev3_tank',inputs:{LEFT_SPEED:shadow(20),RIGHT_SPEED:shadow(20)}},{kind:'block',type:'ev3_spin_right',inputs:{SPEED:shadow(20),ANGLE:shadow(90)}},{kind:'block',type:'ev3_spin_left',inputs:{SPEED:shadow(20),ANGLE:shadow(90)}},{kind:'block',type:'ev3_pivot_right',inputs:{SPEED:shadow(20),ANGLE:shadow(90)}},{kind:'block',type:'ev3_pivot_left',inputs:{SPEED:shadow(20),ANGLE:shadow(90)}},{kind:'block',type:'ev3_drive_forward',inputs:{SPEED:shadow(20),CM:shadow(20)}},{kind:'block',type:'ev3_drive_backward',inputs:{SPEED:shadow(20),CM:shadow(20)}}]},
 {kind:'category',name:'センサー',colour:'#34ccf1',contents:[{kind:'label',text:'EV3 バッテリー'},{kind:'block',type:'ev3_battery_voltage'},{kind:'block',type:'ev3_battery_current'},{kind:'label',text:'タイマー'},{kind:'block',type:'ev3_timer'},{kind:'block',type:'ev3_timer_reset'},{kind:'label',text:'モーターのエンコーダ'},{kind:'block',type:'ev3_encoder'},{kind:'block',type:'ev3_encoder_reset'},{kind:'label',text:'EV3 ジャイロセンサ'},{kind:'block',type:'ev3_gyro_angle'},{kind:'block',type:'ev3_gyro_rate'},{kind:'block',type:'ev3_gyro_compare',inputs:{VALUE:shadow(90)}},{kind:'block',type:'ev3_gyro_reset'},{kind:'label',text:'EV3 タッチセンサ'},{kind:'block',type:'ev3_touch'},{kind:'block',type:'ev3_touch_value'},{kind:'label',text:'EV3 赤外線センサ'},{kind:'block',type:'ev3_ir_proximity'},{kind:'block',type:'ev3_ir_compare',inputs:{VALUE:shadow(20)}},{kind:'block',type:'ev3_ir_button'},{kind:'block',type:'ev3_ir_remote'},{kind:'block',type:'ev3_ir_beacon_detected'},{kind:'block',type:'ev3_ir_beacon_heading'},{kind:'block',type:'ev3_ir_beacon_distance'},{kind:'label',text:'EV3 カラーセンサ'},{kind:'block',type:'ev3_color_is'},{kind:'block',type:'ev3_color_value'},{kind:'block',type:'ev3_reflected_compare',inputs:{VALUE:shadow(50)}},{kind:'block',type:'ev3_reflected'},{kind:'label',text:'EV3 超音波センサ'},{kind:'block',type:'ev3_distance_compare',inputs:{VALUE:shadow(15)}},{kind:'block',type:'ev3_distance'}]},
 {kind:'category',name:'音',colour:'#a570b3',contents:[{kind:'block',type:'ev3_tone',inputs:{FREQUENCY:shadow(440),MS:shadow(200)}}]},
 {kind:'category',name:'制御',colour:controlColour,contents:[{kind:'block',type:'ev3_wait_seconds',inputs:{SECONDS:shadow(1)}},{kind:'block',type:'controls_if'},{kind:'block',type:'controls_if',extraState:{hasElse:true}},{kind:'block',type:'ev3_forever'},{kind:'block',type:'controls_repeat_ext',inputs:{TIMES:shadow(10)}},{kind:'block',type:'controls_whileUntil',fields:{MODE:'UNTIL'}},{kind:'block',type:'controls_whileUntil',fields:{MODE:'WHILE'}},{kind:'block',type:'ev3_wait_until'},{kind:'block',type:'ev3_program_end'},{kind:'block',type:'ev3_myblock_return'}]},
 {kind:'category',name:'演算',colour:operatorColour,contents:[num(0),...['add','sub','mul','div'].map(op=>({kind:'block',type:'ev3_op_'+op,inputs:{A:shadow(1),B:shadow(1)}})),{kind:'block',type:'ev3_math_function',inputs:{VALUE:shadow(1)}},...['lt','eq','gt','lte','gte','neq'].map(op=>({kind:'block',type:'ev3_op_'+op,inputs:{A:shadow(0),B:shadow(100)}})),...['and','or'].map(op=>({kind:'block',type:'ev3_op_'+op})),{kind:'block',type:'logic_negate'},{kind:'block',type:'logic_boolean'}]},
 {kind:'category',name:'変数',colour:'#c58245',custom:'VARIABLE'},
 {kind:'category',name:'マイブロック',colour:'#aa597e',custom:'PROCEDURE'},
 {kind:'category',name:'引数',colour:'#668b6d',custom:'ARGUMENTS'}
]};

// 本体ボタンは互換読み込みのため定義を残し、新規の一覧だけから一時的に外す。
const group=name=>toolbox.contents.find(c=>c.name===name).contents;
group('制御').push({kind:'label',text:'PID制御'},{kind:'block',type:'ev3_pid',inputs:{TARGET:shadow(0),MEASURED:shadow(0),KP:shadow(1),KI:shadow(0),KD:shadow(0)}},{kind:'block',type:'ev3_pid_reset'});
toolbox.contents.splice(1,0,{kind:'category',name:'イベント',colour:'#d3a238',contents:[{kind:'label',text:'センサ・比較を条件の欄に入れます'},{kind:'block',type:'ev3_when_condition'},{kind:'block',type:'ev3_when_changed'},{kind:'label',text:'名前が同じメッセージで連携します'},{kind:'block',type:'ev3_when_message'},{kind:'block',type:'ev3_message_send'},{kind:'block',type:'ev3_message_wait'}]});
group('センサー').splice(group('センサー').findIndex(x=>x.type==='ev3_encoder')+1,0,{kind:'block',type:'ev3_motor_speed'});
group('動き').splice(2,0,...['angle','time'].map(action=>({kind:'block',type:'ev3_tank_'+action,inputs:{LEFT_SPEED:shadow(30),RIGHT_SPEED:shadow(15),...(action==='angle'?{DEGREES:shadow(360)}:{SECONDS:shadow(1)})}})));
group('動き').splice(2,0,...['run','angle','time'].map(action=>({kind:'block',type:'ev3_steering_'+action,inputs:{TURN:shadow(25),SPEED:shadow(20),...(action==='angle'?{DEGREES:shadow(360)}:action==='time'?{SECONDS:shadow(2)}:{})}})));
const movementOrder=['ev3_movement_setup','ev3_wheel','ev3_tread','ev3_steering_run','ev3_steering_angle','ev3_steering_time','ev3_tank_angle','ev3_tank_time','ev3_tank','ev3_spin_right','ev3_spin_left','ev3_pivot_right','ev3_pivot_left','ev3_drive_forward','ev3_drive_backward'];
group('動き').push({kind:'block',type:'ev3_movement_setup'});group('動き').sort((a,b)=>movementOrder.indexOf(a.type)-movementOrder.indexOf(b.type));
// 旋回は寸法設定が必要なまとまりとして、余白と説明で区切る。
const spinIndex=group('動き').findIndex(x=>x.type==='ev3_spin_right');
group('動き')[spinIndex-1].gap=40;
group('動き').splice(spinIndex,0,{kind:'label',text:'旋回前にタイヤ直径・トレッドを設定',gap:16});
group('演算').push(...['mod','random','min','max'].map(op=>({kind:'block',type:'ev3_data_'+op,inputs:{A:shadow(1),B:shadow(10)}})),{kind:'block',type:'ev3_data_round',inputs:{A:shadow(1.5)}},{kind:'block',type:'ev3_data_clamp',inputs:{A:shadow(120),LOW:shadow(-100),HIGH:shadow(100)}});
const textShadow=t=>({shadow:{type:'ev3_text',fields:{TEXT:t}}});
toolbox.contents.splice(toolbox.contents.findIndex(c=>c.name==='変数'),0,
 {kind:'category',name:'画面',colour:'#9966ff',contents:[{kind:'label',text:'EV3本体：178×128ドット／左上が0,0'},{kind:'block',type:'ev3_display_clear'},{kind:'block',type:'ev3_display_text'},{kind:'block',type:'ev3_display_image'},{kind:'block',type:'ev3_display_number',inputs:{VALUE:shadow(12.5)}}]},
 {kind:'category',name:'ランプ',colour:'#9966ff',contents:[{kind:'block',type:'ev3_led'},{kind:'block',type:'ev3_led_off'}]},
 {kind:'category',name:'データ',colour:'#ff8c1a',contents:[{kind:'label',text:'文字列（UTF-8で120バイトまで）'},{kind:'block',type:'ev3_text'},{kind:'block',type:'ev3_text_get'},{kind:'block',type:'ev3_text_set',inputs:{VALUE:textShadow('こんにちは')}},{kind:'block',type:'ev3_text_join',inputs:{A:textShadow('こんにちは'),B:textShadow('EV3')}},{kind:'block',type:'ev3_text_length',inputs:{VALUE:textShadow('こんにちは')}},{kind:'block',type:'ev3_text_letter',inputs:{VALUE:textShadow('こんにちは'),INDEX:shadow(1)}},...['contains','equal'].map(op=>({kind:'block',type:'ev3_text_'+op,inputs:{A:textShadow('こんにちは'),B:textShadow('こん')}})),{kind:'block',type:'ev3_text_number',inputs:{VALUE:shadow(12.5)}},{kind:'block',type:'ev3_text_to_number',inputs:{VALUE:textShadow('12.5')}},{kind:'label',text:'数値リスト（同じ名前で共有）'},...['clear','add','set','delete','item','length','contains','stat'].map(op=>({kind:'block',type:'ev3_list_'+op,inputs:{...(['set','delete','item'].includes(op)?{INDEX:shadow(1)}:{}),...(['add','set','contains'].includes(op)?{VALUE:shadow(0)}:{})}}))]},
 {kind:'category',name:'記録',colour:'#c58245',contents:[{kind:'block',type:'ev3_log_start'},{kind:'block',type:'ev3_log_value',inputs:{VALUE:shadow(0)}},{kind:'block',type:'ev3_log_end'}]});

// 置かれた定義の中で引数を解決する。IDが異なる同名ブロックも使えるが、実行時の値は呼び出しごとに独立する。
function argumentModel(block){
 const root=block.getRootBlock();if(root.type!=='procedures_defnoreturn')return null;
 const models=root.getVarModels();return models.find(m=>m.getId()===block.parameterId)??models.find(m=>m.getName()===block.getFieldValue('ARG_NAME'))??null;
}
// 以前の作品で通常の変数ブロックとして保存されていた引数も、その定義内では引数として扱う。
function localArgument(block){
 const root=block.getRootBlock(),model=block.getField('VAR')?.getVariable();
 return model && root.type==='procedures_defnoreturn' && root.getVarModels().some(m=>m.getId()===model.getId())?model:null;
}
// 引数だけに使う名前を通常の変数一覧から除外する。プログラム全体で使っている同名変数は残す。
function ordinaryVariables(ws){
 const parameters=new Set(),usedGlobally=new Set();
 for(const b of ws.getAllBlocks(false)){
   if(b.type==='procedures_defnoreturn')for(const m of b.getVarModels())parameters.add(m.getId());
   if(['variables_get','variables_set','math_change'].includes(b.type) && !localArgument(b)){const m=b.getField('VAR')?.getVariable();if(m)usedGlobally.add(m.getId());}
 }
 return ws.getVariableMap().getAllVariables().filter(m=>!parameters.has(m.getId())||usedGlobally.has(m.getId()));
}
// 変数の取得ブロックは名前ごとに並べ、代入・増減のブロックでは変数名を選択できるようにする。
function variableFlyout(ws){
 const variables=ordinaryVariables(ws);
 const items=[{kind:'label',text:'プログラム全体で使う変数'},{kind:'button',text:'変数をつくる',callbackKey:'EV3_CREATE_VARIABLE'}];
 if(variables.length){
   const fields={VAR:{id:variables[0].getId()}};
   items.push({kind:'block',type:'variables_set',fields,inputs:{VALUE:shadow(0)}},
    {kind:'block',type:'math_change',fields,inputs:{DELTA:shadow(1)}});
   items.push(...variables.map(m=>({kind:'block',type:'variables_get',fields:{VAR:{id:m.getId()}}})));
 }
 if(!variables.length)items.push({kind:'label',text:'「変数をつくる」で名前を付けます'});
 return items;
}
function createOrdinaryVariable(ws,name){
 name=String(name).trim();
 if(!name||name.length>40)throw Error('変数の名前を1〜40文字で入力してください。');
 if(ws.getVariableMap().getAllVariables().some(m=>Blockly.Names.equals(m.getName(),name)))throw Error('同じ名前の変数または引数があります。別の名前を付けてください。');
 return ws.getVariableMap().createVariable(name);
}
// 同名の引数を一覧では1個にまとめる。どの定義の値かは、配置後にargumentModelが判断する。
function argumentFlyout(ws){
 const items=[{kind:'label',text:'定義の中だけで使う引数'}],names=new Map();
 for(const def of ws.getAllBlocks(false).filter(b=>b.type==='procedures_defnoreturn'))for(const m of def.getVarModels())if(!names.has(m.getName()))names.set(m.getName(),m);
 items.push(...[...names.values()].map(m=>({kind:'block',type:'ev3_argument',extraState:{parameterId:m.getId(),name:m.getName()}})));
 if(!names.size)items.push({kind:'label',text:'「マイブロックを作る」で引数を追加します'});
 else items.push({kind:'label',text:'同じ名前を定義したマイブロックで使えます'});
 return items;
}
Blockly.Blocks.ev3_argument={
 init:function(){this.parameterId='';this.appendDummyInput().appendField(new Blockly.FieldLabelSerializable('名前'),'ARG_NAME');this.setOutput(true,'Number');this.setColour('#aa597e');this.setTooltip('同じ引数名を定義したマイブロックの中で使えます。値は呼び出しごとに別々です。');},
 saveExtraState:function(){return {parameterId:this.parameterId,name:this.getFieldValue('ARG_NAME')};},
 loadExtraState:function(state){this.parameterId=String(state.parameterId??'');this.setFieldValue(String(state.name??'名前'),'ARG_NAME');}
};
for(const type of ['variables_get','variables_set','math_change']){
 const init=Blockly.Blocks[type].init;
 Blockly.Blocks[type].init=function(){
   init.call(this);
   const field=this.getField('VAR'),originalOptions=field.getOptions.bind(field);
   field.getOptions=function(useCache){
     const ws=this.getSourceBlock().workspace.targetWorkspace??this.getSourceBlock().workspace;
     const allowed=new Set(ordinaryVariables(ws).map(m=>m.getId()));
     return originalOptions(useCache).filter(option=>!ws.getVariableMap().getVariableById(option[1])||allowed.has(option[1])||option[1]===this.getValue());
   };
 };
}


// A plain form replaces the procedure mutator, including on restored projects.
const originalDefinitionInit=Blockly.Blocks.procedures_defnoreturn.init;
Blockly.Blocks.procedures_defnoreturn.init=function(){
 originalDefinitionInit.call(this);this.setMutator(null);
 const menu=this.customContextMenu;
 this.customContextMenu=function(options){menu?.call(this,options);options.unshift({text:'名前・引数を編集',enabled:true,callback:()=>openMyBlockDialog(this.id)});};
};
// マイブロックの作成・編集。名前と引数を先に検証し、呼び出し側の入力式を保持したまま更新する。
// 途中で失敗した場合はワークスペースの控えから復元し、半端な編集状態を残さない。
function saveMyBlock(ws,name,rows,definitionId=null){
 name=String(name).trim();rows=rows.map(row=>({name:String(row.name).trim(),id:row.id||''}));
 const defs=ws.getAllBlocks(false).filter(b=>b.type==='procedures_defnoreturn');
 const def=definitionId?ws.getBlockById(definitionId):null;
 if(definitionId&&!def)throw Error('編集する定義が見つかりません。');
 if(!name||name.length>60)throw Error('マイブロックの名前を1〜60文字で入力してください。');
 if(defs.some(b=>b!==def&&b.getFieldValue('NAME').toLowerCase()===name.toLowerCase()))throw Error('同じ名前のマイブロックがあります。');
 if(!def&&defs.length>=32)throw Error('マイブロックは32個までです。');
 if(rows.length>8||rows.some(r=>!r.name||r.name.length>40))throw Error('引数は8個まで、名前は1〜40文字で入力してください。');
 if(new Set(rows.map(r=>r.name.toLowerCase())).size!==rows.length)throw Error('引数には別々の名前を付けてください。');
 const oldModels=def?.getVarModels()??[],oldIds=oldModels.map(m=>m.getId());
 if(rows.some(r=>r.id&&!oldIds.includes(r.id))||new Set(rows.filter(r=>r.id).map(r=>r.id)).size!==rows.filter(r=>r.id).length)throw Error('引数の編集情報を確認してください。');
 const body=def?.getDescendants(false)??[];
 const bodyIds=new Map(body.map(b=>[b.id,b.type==='ev3_argument'?(argumentModel(b)?.getId()??b.parameterId):b.getFieldValue('VAR')]));
 for(const b of body){const id=bodyIds.get(b.id);
  if(oldIds.includes(id)&&!rows.some(r=>r.id===id))throw Error('使っている引数は削除できません。定義の中の引数ブロックを先に外してください。');
 }
 const backup=Blockly.serialization.workspaces.save(ws),oldName=def?.getFieldValue('NAME');
 const calls=def?Blockly.Procedures.getCallers(oldName,ws).map(call=>({call,args:oldIds.map((id,i)=>({id,block:call.getInputTargetBlock('ARG'+i)}))})):[];
 Blockly.Events.setGroup(true);
 try{
  // Preserve argument expressions explicitly: the stock mutator drops its
  // connection cache when its bubble is not present.
  for(const {args} of calls)for(const a of args)if(a.block){a.state=Blockly.serialization.blocks.save(a.block);a.block.unplug();}
  const models=rows.map(r=>ws.getVariableMap().getVariable(r.name,'')??ws.getVariableMap().createVariable(r.name));
  const target=def??ws.newBlock('procedures_defnoreturn');
  target.setFieldValue(name,'NAME');
  target.loadExtraState({params:models.map(m=>({name:m.getName(),id:m.getId()}))});
  for(const b of body){const id=bodyIds.get(b.id);const index=rows.findIndex(r=>r.id===id);if(index<0)continue;
   if(b.type==='ev3_argument'){b.parameterId=models[index].getId();b.setFieldValue(rows[index].name,'ARG_NAME');}
   else if(['variables_get','variables_set','math_change'].includes(b.type))b.setFieldValue(models[index].getId(),'VAR');
  }
  for(const {call,args} of calls){
   call.renameProcedure(call.getProcedureCall(),name);call.loadExtraState({name,params:rows.map(r=>r.name)});
   rows.forEach((r,i)=>{const a=args.find(a=>a.id===r.id);if(a?.state){let child=ws.getBlockById(a.state.id);if(!child)child=Blockly.serialization.blocks.append(a.state,ws);call.getInput('ARG'+i).connection.connect(child.outputConnection);}else{const n=ws.newBlock('math_number');n.setShadow(true);n.setFieldValue('0','NUM');call.getInput('ARG'+i).connection.connect(n.outputConnection);n.initSvg?.();n.render?.();}});
  }
  target.initSvg?.();target.render?.();
  if(!def){const bottom=Math.max(20,...ws.getTopBlocks(false).filter(b=>b!==target).map(b=>b.getRelativeToSurfaceXY().y+(b.getHeightWidth?.().height??80)));target.moveBy(60,bottom+60);}
  return target;
 }catch(error){Blockly.serialization.workspaces.load(backup,ws);throw error;}
 finally{Blockly.Events.setGroup(false);}
}

// Blocklyの色・表示・操作を初期化する。独自ブロックの型名は保存データの互換性にも関わる。
// 授業で独立して試せる、走行＋計測・センサイベント・メッセージの3例。
// 実機確認用。モーターを動かさず、ポート1の角度と回転速度を約10秒記録する。
// 本体での確認用。どちらのサンプルもモーターへ命令しない。
function commonMovementSampleState(kind){return [{"blocks":{"languageVersion":0,"blocks":[{"type":"ev3_start","x":35,"y":35,"next":{"block":{"type":"ev3_movement_setup","fields":{"LEFT_PORT":"2","RIGHT_PORT":"4"},"next":{"block":{"type":"ev3_wheel","fields":{"DIAMETER":56},"next":{"block":{"type":"ev3_drive_forward","inputs":{"SPEED":{"shadow":{"type":"math_number","fields":{"NUM":20}}},"CM":{"shadow":{"type":"math_number","fields":{"NUM":20}}}}}}}}}}}]}},{"blocks":{"languageVersion":0,"blocks":[{"type":"ev3_start","x":35,"y":35,"next":{"block":{"type":"ev3_movement_setup","fields":{"LEFT_PORT":"2","RIGHT_PORT":"4"},"next":{"block":{"type":"ev3_wheel","fields":{"DIAMETER":56},"next":{"block":{"type":"ev3_drive_forward","inputs":{"SPEED":{"shadow":{"type":"math_number","fields":{"NUM":20}}},"CM":{"shadow":{"type":"math_number","fields":{"NUM":20}}}},"next":{"block":{"type":"ev3_wait_seconds","inputs":{"SECONDS":{"shadow":{"type":"math_number","fields":{"NUM":1}}}},"next":{"block":{"type":"ev3_movement_setup","fields":{"LEFT_PORT":"1","RIGHT_PORT":"8"},"next":{"block":{"type":"ev3_drive_backward","inputs":{"SPEED":{"shadow":{"type":"math_number","fields":{"NUM":20}}},"CM":{"shadow":{"type":"math_number","fields":{"NUM":20}}}}}}}}}}}}}}}}}]}},{"blocks":{"languageVersion":0,"blocks":[{"type":"ev3_start","x":35,"y":35,"next":{"block":{"type":"ev3_movement_setup","fields":{"LEFT_PORT":"2","RIGHT_PORT":"4"},"next":{"block":{"type":"ev3_wheel","fields":{"DIAMETER":56},"next":{"block":{"type":"procedures_callnoreturn","extraState":{"name":"前進","params":["距離"]},"inputs":{"ARG0":{"shadow":{"type":"math_number","fields":{"NUM":20}}}}}}}}}}},{"type":"procedures_defnoreturn","x":520,"y":40,"fields":{"NAME":"前進"},"extraState":{"params":[{"name":"距離","id":"shared-distance"}]},"inputs":{"STACK":{"block":{"type":"ev3_drive_forward","inputs":{"SPEED":{"shadow":{"type":"math_number","fields":{"NUM":20}}},"CM":{"block":{"type":"ev3_argument","extraState":{"name":"距離","parameterId":"shared-distance"},"fields":{"ARG_NAME":"距離"}}}}}}}}]},"variables":[{"name":"距離","id":"shared-distance"}]}][{basic:0,switch:1,myblock:2}[kind]];}
function movementSampleState(state,left='2',right='4'){
 let found=false;
 const scan=x=>{if(!x||typeof x!=='object')return;if(/^ev3_(drive_|spin_|pivot_|steering_|tank(?:_|$))/.test(x.type??'')){found=true;if(x.fields){delete x.fields.PORTS;delete x.fields.LEFT_PORT;delete x.fields.RIGHT_PORT;}}for(const value of Object.values(x))scan(value);};scan(state);
 if(found)for(const block of state.blocks?.blocks??[])if(block.type==='ev3_start')block.next={block:{type:'ev3_movement_setup',fields:{LEFT_PORT:left,RIGHT_PORT:right},...(block.next?{next:block.next}:{})}};
 return state;
}
function powerPidSampleState(kind){
 return [{"blocks":{"languageVersion":0,"blocks":[{"type":"ev3_start","x":40,"y":35,"next":{"block":{"type":"ev3_display_clear","next":{"block":{"type":"ev3_log_start","fields":{"FILE":"Battery"},"next":{"block":{"type":"controls_repeat_ext","inputs":{"TIMES":{"shadow":{"type":"math_number","fields":{"NUM":20}}},"DO":{"block":{"type":"ev3_log_value","fields":{"LABEL":"voltage_V"},"inputs":{"VALUE":{"block":{"type":"ev3_battery_voltage"}}},"next":{"block":{"type":"ev3_log_value","fields":{"LABEL":"current_A"},"inputs":{"VALUE":{"block":{"type":"ev3_battery_current"}}},"next":{"block":{"type":"ev3_display_number","fields":{"X":0,"Y":0,"FONT":"2","DECIMALS":2},"inputs":{"VALUE":{"block":{"type":"ev3_battery_voltage"}}},"next":{"block":{"type":"ev3_display_number","fields":{"X":0,"Y":32,"FONT":"2","DECIMALS":3},"inputs":{"VALUE":{"block":{"type":"ev3_battery_current"}}},"next":{"block":{"type":"ev3_wait_seconds","inputs":{"SECONDS":{"shadow":{"type":"math_number","fields":{"NUM":0.5}}}}}}}}}}}}}}},"next":{"block":{"type":"ev3_log_end","next":{"block":{"type":"ev3_wait_seconds","inputs":{"SECONDS":{"shadow":{"type":"math_number","fields":{"NUM":2}}}}}}}}}}}}}}}]}},{"blocks":{"languageVersion":0,"blocks":[{"type":"ev3_start","x":40,"y":35,"next":{"block":{"type":"ev3_display_clear","next":{"block":{"type":"ev3_pid_reset","fields":{"NAME":"PID1"},"next":{"block":{"type":"ev3_log_start","fields":{"FILE":"PID"},"next":{"block":{"type":"controls_repeat_ext","inputs":{"TIMES":{"shadow":{"type":"math_number","fields":{"NUM":10}}},"DO":{"block":{"type":"variables_set","fields":{"VAR":{"id":"pid-example-output","name":"PID出力"}},"inputs":{"VALUE":{"block":{"type":"ev3_pid","fields":{"NAME":"PID1"},"inputs":{"TARGET":{"shadow":{"type":"math_number","fields":{"NUM":10}}},"MEASURED":{"shadow":{"type":"math_number","fields":{"NUM":4}}},"KP":{"shadow":{"type":"math_number","fields":{"NUM":1}}},"KI":{"shadow":{"type":"math_number","fields":{"NUM":0.5}}},"KD":{"shadow":{"type":"math_number","fields":{"NUM":0.1}}}}}}},"next":{"block":{"type":"ev3_log_value","fields":{"LABEL":"output"},"inputs":{"VALUE":{"block":{"type":"variables_get","fields":{"VAR":{"id":"pid-example-output","name":"PID出力"}}}}},"next":{"block":{"type":"ev3_display_number","fields":{"X":0,"Y":0,"FONT":"2","DECIMALS":3},"inputs":{"VALUE":{"block":{"type":"variables_get","fields":{"VAR":{"id":"pid-example-output","name":"PID出力"}}}}},"next":{"block":{"type":"ev3_wait_seconds","inputs":{"SECONDS":{"shadow":{"type":"math_number","fields":{"NUM":0.1}}}}}}}}}}}}},"next":{"block":{"type":"ev3_log_end","next":{"block":{"type":"ev3_wait_seconds","inputs":{"SECONDS":{"shadow":{"type":"math_number","fields":{"NUM":2}}}}}}}}}}}}}}}}}]},"variables":[{"id":"pid-example-output","name":"PID出力"}]}][kind==='battery'?0:1];
}

function gyroSampleState(){
 return {"blocks":{"languageVersion":0,"blocks":[{"type":"ev3_start","x":40,"y":35,"next":{"block":{"type":"ev3_wait_seconds","inputs":{"SECONDS":{"shadow":{"type":"math_number","fields":{"NUM":1}}}},"next":{"block":{"type":"ev3_gyro_reset","fields":{"PORT":"1"},"next":{"block":{"type":"ev3_tone","inputs":{"FREQUENCY":{"shadow":{"type":"math_number","fields":{"NUM":440}}},"MS":{"shadow":{"type":"math_number","fields":{"NUM":200}}}},"fields":{"VOLUME":25},"next":{"block":{"type":"ev3_log_start","fields":{"FILE":"Gyro"},"next":{"block":{"type":"ev3_display_clear","next":{"block":{"type":"controls_repeat_ext","inputs":{"TIMES":{"shadow":{"type":"math_number","fields":{"NUM":50}}},"DO":{"block":{"type":"ev3_log_value","fields":{"LABEL":"angle_deg"},"inputs":{"VALUE":{"block":{"type":"ev3_gyro_angle","fields":{"PORT":"1"}}}},"next":{"block":{"type":"ev3_log_value","fields":{"LABEL":"rate_deg_s"},"inputs":{"VALUE":{"block":{"type":"ev3_gyro_rate","fields":{"PORT":"1"}}}},"next":{"block":{"type":"ev3_display_number","fields":{"X":0,"Y":0,"FONT":"2","DECIMALS":0},"inputs":{"VALUE":{"block":{"type":"ev3_gyro_angle","fields":{"PORT":"1"}}}},"next":{"block":{"type":"ev3_display_number","fields":{"X":0,"Y":32,"FONT":"2","DECIMALS":0},"inputs":{"VALUE":{"block":{"type":"ev3_gyro_rate","fields":{"PORT":"1"}}}},"next":{"block":{"type":"ev3_wait_seconds","inputs":{"SECONDS":{"shadow":{"type":"math_number","fields":{"NUM":0.2}}}}}}}}}}}}}}},"next":{"block":{"type":"ev3_log_end","next":{"block":{"type":"ev3_wait_seconds","inputs":{"SECONDS":{"shadow":{"type":"math_number","fields":{"NUM":2}}}}}}}}}}}}}}}}}}}}}]}};
}

function parallelSampleState(kind){return movementSampleState(parallelSampleStateRaw(kind));}
function parallelSampleStateRaw(kind){
 const n=value=>({shadow:{type:'math_number',fields:{NUM:value}}});
 const seq=blocks=>{for(let i=0;i<blocks.length-1;i++)blocks[i].next={block:blocks[i+1]};return blocks[0];};
 const wait=value=>({type:'ev3_wait_seconds',inputs:{SECONDS:n(value)}});
 const end={type:'ev3_program_end'};
 const distance=()=>({block:{type:'ev3_distance',fields:{PORT:'2'}}});
 const log={type:'ev3_log_value',fields:{LABEL:'距離_cm'},inputs:{VALUE:distance()}};
 const repeat=count=>({type:'controls_repeat_ext',inputs:{TIMES:n(count),DO:{block:seq([structuredClone(log),wait(.1)])}}});
 const root=(type,x,y,body,extra={})=>({type,x,y,...extra,next:{block:seq(body)}});
 let blocks,variables=[];
 if(kind==='parallel'){
  const ref={id:'parallel-finished'};variables=[{...ref,name:'計測完了'}];
  blocks=[root('ev3_start',30,30,[{type:'ev3_motor_l_pair_time',fields:{PORTS:'6'},inputs:{SPEED:n(20),SECONDS:n(2)}},{type:'ev3_wait_until',inputs:{BOOL:{block:{type:'ev3_op_eq',inputs:{A:{block:{type:'variables_get',fields:{VAR:ref}}},B:n(1)}}}}},end]),
   root('ev3_start',500,30,[{type:'ev3_log_start',fields:{FILE:'Parallel'}},repeat(20),{type:'ev3_log_end'},{type:'variables_set',fields:{VAR:ref},inputs:{VALUE:n(1)}}])];
 }else if(kind==='event'){
  blocks=[root('ev3_start',30,30,[{type:'ev3_motor_l_pair_run',fields:{PORTS:'6'},inputs:{SPEED:n(20)}}]),root('ev3_when_condition',30,220,[end],{inputs:{BOOL:{block:{type:'ev3_touch',fields:{PORT:'1',STATE:'1'}}}}})];
 }else{
  blocks=[root('ev3_start',30,30,[{type:'ev3_led',fields:{COLOR:'1',MODE:'on'}},{type:'ev3_message_wait',fields:{MESSAGE:'測定'}},{type:'ev3_led',fields:{COLOR:'2',MODE:'on'}},wait(.5),end]),root('ev3_when_message',450,30,[{type:'ev3_log_start',fields:{FILE:'Message'}},repeat(10),{type:'ev3_log_end'}],{fields:{MESSAGE:'測定'}})];
 }
 return {variables,blocks:{languageVersion:0,blocks}};
}

// モーターの新機能を単独で確認できる作品例。転送だけでは動かず、実行操作で動く。
function motorSampleState(kind){return movementSampleState(motorSampleStateRaw(kind));}
function motorSampleStateRaw(kind){
 const n=value=>({shadow:{type:'math_number',fields:{NUM:value}}});
 const wait=seconds=>({type:'ev3_wait_seconds',inputs:{SECONDS:n(seconds)}});
 const setting=(ports,mode)=>({type:'ev3_motor_stop_mode',fields:{PORTS:ports,MODE:mode}});
 const log=label=>({type:'ev3_log_value',fields:{LABEL:label},inputs:{VALUE:{block:{type:'ev3_motor_speed',fields:{PORT:'2'}}}}});
 let steps;
 if(kind==='stop')steps=['coast','brake','hold'].flatMap(mode=>[setting('2',mode),{type:'ev3_motor_l_single_rotation',fields:{PORTS:'2'},inputs:{SPEED:n(20),ROTATIONS:n(.25)}},wait(1)]);
 else if(kind==='tank')steps=[setting('6','hold'),{type:'ev3_tank_angle',fields:{LEFT_PORT:'2',RIGHT_PORT:'4'},inputs:{LEFT_SPEED:n(30),RIGHT_SPEED:n(15),DEGREES:n(180)}},wait(.5),{type:'ev3_tank_time',fields:{LEFT_PORT:'2',RIGHT_PORT:'4'},inputs:{LEFT_SPEED:n(30),RIGHT_SPEED:n(-30),SECONDS:n(.5)}},wait(.5)];
 else steps=[{type:'ev3_log_start',fields:{FILE:'Power'}},{type:'ev3_motor_l_single_run',fields:{PORTS:'2'},inputs:{SPEED:n(20)}},wait(.5),log('速度指定20'),{type:'ev3_motor_speed_set',fields:{PORTS:'2'},inputs:{SPEED:n(30)}},wait(.5),log('速度変更30'),{type:'ev3_motor_power',fields:{PORTS:'2'},inputs:{POWER:n(20)}},wait(.5),log('パワー指定20'),{type:'ev3_stop_port',fields:{PORTS:'2',STOP_MODE:'hold'}},wait(1),{type:'ev3_log_end'}];
 steps.push({type:'ev3_program_end'});for(let i=0;i<steps.length-1;i++)steps[i].next={block:steps[i+1]};
 return {blocks:{languageVersion:0,blocks:[{type:'ev3_start',x:30,y:30,next:{block:steps[0]}}]}};
}

// 「複製」は選択ブロックから下の命令と、各命令の入力・入れ子もまとめてコピーする。
// Blockly 標準の貼り付けを使い、新しい ID、配置、取り消しのまとまりを維持する。
function stackCopyData(block){
 const data=block.toCopyData(true);
 if(!data)return null;
 // 標準 toCopyData の個数は単体用なので、容量判定もスタック全体に合わせる。
 data.typeCounts=Object.create(null);
 for(const child of block.getDescendants(false))data.typeCounts[child.type]=(data.typeCounts[child.type]||0)+1;
 return data;
}
function configureEditorInteractions(workspace){
 Blockly.Msg.DUPLICATE_BLOCK='複製';
 const duplicate=Blockly.ContextMenuRegistry.registry.getItem('blockDuplicate');
 if(duplicate)duplicate.callback=({block})=>{
  if(!block)return;
  const data=stackCopyData(block);
  if(data)Blockly.clipboard.paste(data,block.workspace);
 };
 // パレットから取り出しても開いたままにし、背景をクリックしたときだけ閉じる。
 workspace.getFlyout().setAutoClose(false);
 workspace.addChangeListener(event=>{
  if(event.type===Blockly.Events.CLICK&&event.targetType==='workspace')workspace.getToolbox().clearSelection();
 });
}
const theme=Blockly.Theme.defineTheme('ev3lab',{base:Blockly.Themes.Classic,fontStyle:{family:'"Yu Gothic UI", Meiryo, sans-serif',size:12},blockStyles:{procedure_blocks:{colourPrimary:'#aa597e'},math_blocks:{colourPrimary:'#668b6d'},variable_blocks:{colourPrimary:'#c58245'},loop_blocks:{colourPrimary:'#d19636'}},componentStyles:{workspaceBackgroundColour:'#fbfcfd',toolboxBackgroundColour:'#f4f7f8',flyoutBackgroundColour:'#eef3f5',flyoutOpacity:1,scrollbarColour:'#b9c9ce',insertionMarkerColour:'#126c67',insertionMarkerOpacity:.3}});
const workspace=Blockly.inject('blocklyDiv',{toolbox,theme,renderer:'zelos',media:'vendor/media/',trashcan:true,scrollbars:true,grid:{spacing:24,length:2,colour:'#e5ebee',snap:false},zoom:{controls:true,wheel:true,startScale:.85,minScale:.35,maxScale:1.5,scaleSpeed:1.1},move:{scrollbars:true,drag:true,wheel:true},sounds:false});
configureEditorInteractions(workspace);
workspace.registerToolboxCategoryCallback('ARGUMENTS',argumentFlyout);
workspace.registerToolboxCategoryCallback('VARIABLE',variableFlyout);
workspace.registerButtonCallback('EV3_CREATE_VARIABLE',()=>openVariableDialog());
workspace.registerButtonCallback('EV3_CREATE_MYBLOCK',()=>openMyBlockDialog());
workspace.registerToolboxCategoryCallback('PROCEDURE',ws=>{
 const items=[{kind:'button',text:'マイブロックを作る',callbackKey:'EV3_CREATE_MYBLOCK'}];
 for(const def of ws.getAllBlocks(false).filter(b=>b.type==='procedures_defnoreturn')){
  const key='EV3_EDIT_'+def.id,name=def.getFieldValue('NAME'),models=def.getVarModels();
  workspace.registerButtonCallback(key,()=>openMyBlockDialog(def.id));
  items.push({kind:'block',type:'procedures_callnoreturn',extraState:{name,params:models.map(m=>m.getName())},inputs:Object.fromEntries(models.map((m,i)=>['ARG'+i,shadow(0)]))},{kind:'button',text:'「'+name+'」を編集',callbackKey:key});
 }
 return items;
});
let lastBuild=null,busy=false,loading=false,dirty=false,saveTimer,baselineCounts=null,lastTimingSignature=null,monitorTimer=null;
const logs=[];
// 通信と操作の記録を画面に表示する。長時間利用時の増大を防ぐため、直近1200行だけ保持する。
function log(type,message){
  const line=`${new Date().toISOString()} [${type}] ${message}`;logs.push(line);if(logs.length>1200)logs.shift();
  $('log').textContent=logs.join('\n');$('log').scrollTop=$('log').scrollHeight;
  $('lastLog').textContent=`${type} · ${message}`;
}
const connection=new EV3Connection(log,connected=>{
  if(!connected){stopSensorMonitor();clearSensorValues();baselineCounts=null;$('countResult').textContent='切断したため計測の開始角度を解除しました。接続後に記録し直してください。';}
  $('connection').classList.toggle('connected',connected);$('connection').innerHTML=connected?'<i></i>接続済み':'<i></i>未接続';
  if(!connected)$('brickLabel').textContent=($('connectionMethod').value==='usb'?'USB':'Bluetooth')+' / 未接続';
  $('connect').hidden=connected;$('disconnect').hidden=!connected;updateButtons();
});
// 接続済みだけで転送可能にはしない。有効な名前・生成成功・通信中でないことを合わせて判定する。
function updateButtons(){
  let validName=true;
  try{programFileName($('programName').value);}catch{validName=false;}
  $('programName').setAttribute('aria-invalid',String(!validName));
  $('programNameError').hidden=validName;
  let validFolder=true;try{projectDirectory($('ev3ProjectName').value);}catch{validFolder=false;}
  $('ev3ProjectName').setAttribute('aria-invalid',String(!validFolder));$('ev3ProjectNameError').hidden=validFolder;
  $('ev3ProjectName').disabled=busy;
  $('destinationPreview').textContent=validFolder && validName?$('ev3ProjectName').value+' → '+$('programName').value+'.rbf':'保存先の名前を確認してください。';
  $('programName').disabled=busy;
  $('connectionMethod').disabled=busy||connection.connected;
  $('transfer').disabled=busy || !connection.connected || !lastBuild || !validName || !validFolder;
  $('transferRun').disabled=$('transfer').disabled;$('stopProgram').disabled=busy||!connection.connected;
  $('exportCsv').disabled=busy||!connection.connected;$('readSensors').disabled=busy||!connection.connected;$('autoSensors').disabled=!connection.connected;
  $('connect').disabled=busy||!isSecureContext||!($('connectionMethod').value==='usb'?navigator.hid:navigator.serial);$('disconnect').disabled=busy;$('downloadRbf').disabled=busy || !lastBuild || !validName || !validFolder;
  $('recordCounts').disabled=busy || !connection.connected;
  $('readCounts').disabled=busy || !connection.connected || !baselineCounts;
  $('readTiming').disabled=busy || !connection.connected || !lastBuild?.diagnosticPath;
}
// 丸い数値ブロック・条件ブロックを中間データへ変換する。センサやボタンの実測はここでは行わない。
function expression(x){
 if(!x)throw Error('数値・条件の空欄にブロックを入れてください。');
 if(x.type==='ev3_text')return {text:x.getFieldValue('TEXT')};
 if(x.type==='ev3_text_get')return {textVar:x.getFieldValue('NAME')};
 if(x.type==='ev3_text_join')return {textOp:'join',a:value(x,'A'),b:value(x,'B')};
 if(x.type==='ev3_text_letter')return {textOp:'letter',value:value(x,'VALUE'),index:value(x,'INDEX')};
 if(x.type==='ev3_text_number')return {textOp:'number',value:value(x,'VALUE')};
 if(['ev3_text_length','ev3_text_to_number'].includes(x.type))return {textData:{op:x.type==='ev3_text_length'?'length':'number',value:value(x,'VALUE')}};
 if(['ev3_text_contains','ev3_text_equal'].includes(x.type))return {textData:{op:x.type.slice(9),value:value(x,'A'),other:value(x,'B')}};
 if(x.type.startsWith('ev3_list_'))return {listData:{op:x.type==='ev3_list_stat'?x.getFieldValue('OP'):x.type.slice(9),list:x.getFieldValue('LIST'),...(x.getInput('INDEX')?{index:value(x,'INDEX')}:{}),...(x.getInput('VALUE')?{value:value(x,'VALUE')}:{})}};
 if(x.type.startsWith('ev3_data_'))return {numeric:{op:x.type.slice(9),a:value(x,'A'),...(x.getInput('B')?{b:value(x,'B')}:{}),...(x.type==='ev3_data_clamp'?{low:value(x,'LOW'),high:value(x,'HIGH')}:{})}};
 if(x.type==='math_number')return Number(x.getFieldValue('NUM'));
 if(x.type==='ev3_argument'){
   const name=x.getFieldValue('ARG_NAME'),model=argumentModel(x);
   if(!model)throw Error('「引数 '+name+'」は、その引数を定義したマイブロックの中につなげてください。');
   return {param:model.name};
 }
 if(x.type==='variables_get'){
   const model=x.getField('VAR').getVariable(),root=x.getRootBlock();
   return root.type==='procedures_defnoreturn' && root.getVarModels().some(m=>m.getId()===model.getId())?{param:model.name}:{var:model.name};
 }

 if(['ev3_brick_button','ev3_brick_button_value'].includes(x.type)){const reading={button:{id:Number(x.getFieldValue('BUTTON'))}};return x.type==='ev3_brick_button'?{op:'eq',left:reading,right:Number(x.getFieldValue('STATE'))}:reading;}
 if(x.type==='ev3_battery_voltage'||x.type==='ev3_battery_current')return {battery:x.type==='ev3_battery_voltage'?'voltage':'current'};
 if(x.type==='ev3_pid')return {pid:{name:x.getFieldValue('NAME'),target:value(x,'TARGET'),measured:value(x,'MEASURED'),kp:value(x,'KP'),ki:value(x,'KI'),kd:value(x,'KD')}};
 if(x.type==='ev3_timer')return {timer:true};
 if(x.type==='ev3_motor_speed')return {sensor:{kind:'motorSpeed',port:Number(x.getFieldValue('PORT'))}};
 if(x.type==='ev3_encoder')return {sensor:{kind:'encoder',port:Number(x.getFieldValue('PORT'))}};
 if(['ev3_gyro_angle','ev3_gyro_rate','ev3_gyro_compare'].includes(x.type)){const reading={sensor:{kind:x.type==='ev3_gyro_rate'?'gyroRate':x.type==='ev3_gyro_angle'?'gyroAngle':x.getFieldValue('MEASURE'),port:Number(x.getFieldValue('PORT'))}};return x.type==='ev3_gyro_compare'?{op:x.getFieldValue('OP'),left:reading,right:expression(x.getInputTargetBlock('VALUE'))}:reading;}
 if(['ev3_touch','ev3_touch_value'].includes(x.type)){const reading={sensor:{kind:'touch',port:Number(x.getFieldValue('PORT'))}};return x.type==='ev3_touch'?{op:'eq',left:reading,right:Number(x.getFieldValue('STATE'))}:reading;}
 const infraredKinds={ev3_ir_proximity:'infrared',ev3_ir_compare:'infrared',ev3_ir_remote:'irRemote',ev3_ir_button:'irRemote',ev3_ir_beacon_detected:'irBeaconDetected',ev3_ir_beacon_heading:'irBeaconHeading',ev3_ir_beacon_distance:'irBeaconDistance'};
 if(infraredKinds[x.type]){const kind=infraredKinds[x.type],reading={sensor:{kind,port:Number(x.getFieldValue('PORT')),...(kind==='infrared'?{}:{channel:Number(x.getFieldValue('CHANNEL'))})}};
  if(x.type==='ev3_ir_compare')return {op:x.getFieldValue('OP'),left:reading,right:value(x,'VALUE')};
  if(x.type==='ev3_ir_button')return {op:'eq',left:reading,right:Number(x.getFieldValue('BUTTON'))};return reading;
 }
 if(['ev3_color_value','ev3_reflected','ev3_distance','ev3_color_is','ev3_reflected_compare','ev3_distance_compare'].includes(x.type)){
   const kind=x.type.startsWith('ev3_color')?'color':x.type.startsWith('ev3_reflected')?'reflected':'distance';
   const reading={sensor:{kind,port:Number(x.getFieldValue('PORT'))}};
   if(x.type==='ev3_color_is')return {op:'eq',left:reading,right:Number(x.getFieldValue('COLOR'))};
   if(x.type.endsWith('_compare'))return {op:x.getFieldValue('OP'),left:reading,right:value(x,'VALUE')};
   return reading;
 }
 if(x.type==='ev3_math_function')return {math:{fn:x.getFieldValue('FUNCTION'),value:value(x,'VALUE')}};
 if(x.type.startsWith('ev3_op_')&&Object.hasOwn(operatorKinds,x.type.slice(7)))return {op:x.type.slice(7),left:value(x,'A'),right:value(x,'B')};
 if(x.type==='ev3_math')return {op:x.getFieldValue('OP'),left:value(x,'A'),right:value(x,'B')};
 if(x.type==='logic_compare')return {op:({EQ:'eq',NEQ:'neq',LT:'lt',LTE:'lte',GT:'gt',GTE:'gte'})[x.getFieldValue('OP')],left:value(x,'A'),right:value(x,'B')};
 if(x.type==='logic_operation')return {op:x.getFieldValue('OP')==='AND'?'and':'or',left:value(x,'A'),right:value(x,'B')};
 if(x.type==='logic_negate')return {not:value(x,'BOOL')};
 if(x.type==='logic_boolean')return x.getFieldValue('BOOL')==='TRUE'?1:0;
 throw Error('未対応の数値・条件ブロックです。');
}
function value(b,name){return expression(b.getInputTargetBlock(name));}
// つながっている命令を上から順に中間データへ変換する。分岐・繰り返しの内部は再帰的にたどる。
// モーター停止とプログラム終了は別命令。マイブロックのreturnは定義の中だけで許可する。
function chain(block){
  const out=[];
  for(let b=block;b;b=b.getNextBlock()){
    if(!b.isEnabled())continue;
    switch(b.type){
      case 'ev3_led':out.push({type:'led',color:Number(b.getFieldValue('COLOR')),mode:b.getFieldValue('MODE')});break;
      case 'ev3_led_off':out.push({type:'led',color:0,mode:'on'});break;
      case 'ev3_steering_run':case 'ev3_steering_angle':case 'ev3_steering_time':out.push({type:'steering',action:b.type.slice(13),movement:true,turn:value(b,'TURN'),speed:value(b,'SPEED'),...(b.getInput('DEGREES')?{degrees:value(b,'DEGREES')}:{}),...(b.getInput('SECONDS')?{seconds:value(b,'SECONDS')}:{})});break;
      case 'ev3_text_set':out.push({type:'textSet',name:b.getFieldValue('NAME'),value:value(b,'VALUE')});break;
      case 'ev3_list_clear':case 'ev3_list_add':case 'ev3_list_set':case 'ev3_list_delete':out.push({type:({clear:'listClear',add:'listAdd',set:'listSet',delete:'listDelete'})[b.type.slice(9)],list:b.getFieldValue('LIST'),...(b.getInput('INDEX')?{index:value(b,'INDEX')}:{}),...(b.getInput('VALUE')?{value:value(b,'VALUE')}:{})});break;
      case 'ev3_log_start':out.push({type:'logStart',file:b.getFieldValue('FILE')});break;
      case 'ev3_log_value':out.push({type:'logValue',label:b.getFieldValue('LABEL'),value:value(b,'VALUE')});break;
      case 'ev3_message_send':case 'ev3_message_wait':out.push({type:'broadcast',message:b.getFieldValue('MESSAGE').trim(),wait:b.type==='ev3_message_wait'});break;
      case 'ev3_log_end':out.push({type:'logEnd'});break;
      case 'variables_set':case 'math_change':{
 const variable=b.getField('VAR').getVariable(),root=b.getRootBlock();
 if(root.type==='procedures_defnoreturn' && root.getVarModels().some(m=>m.getId()===variable.getId()))throw Error('マイブロックの引数は変更できません。通常の変数を選んでください。');
 out.push({type:b.type==='variables_set'?'set':'change',var:variable.name,value:value(b,b.type==='variables_set'?'VALUE':'DELTA')});break;
 }
 case 'controls_if':{
 let branch=chain(b.getInputTargetBlock('ELSE'));
 for(let i=b.elseifCount_||0;i>=0;i--)branch=[{type:'if',condition:value(b,'IF'+i),then:chain(b.getInputTargetBlock('DO'+i)),else:branch}];
 out.push(...branch);break;
 }
 case 'ev3_wait_until':out.push({type:'while',until:true,condition:value(b,'BOOL'),body:[]});break;
 case 'ev3_forever':out.push({type:'forever',body:chain(b.getInputTargetBlock('DO'))});break;
 case 'controls_whileUntil':out.push({type:'while',until:b.getFieldValue('MODE')==='UNTIL',condition:value(b,'BOOL'),body:chain(b.getInputTargetBlock('DO'))});break;
 case 'ev3_ramp':out.push({type:'ramp',mode:b.getFieldValue('MODE'),upSeconds:value(b,'UP'),downSeconds:value(b,'DOWN')});break;
 case 'ev3_motor_l_single_run':case 'ev3_motor_l_pair_run':case 'ev3_motor_m_single_run':case 'ev3_motor_m_pair_run':case 'ev3_motor_l_run':case 'ev3_motor_m_run':out.push({type:'motorRun',ports:Number(b.getFieldValue('PORTS')),speed:value(b,'SPEED')});break;
 case 'ev3_motor_l_single_angle':case 'ev3_motor_l_pair_angle':case 'ev3_motor_m_single_angle':case 'ev3_motor_m_pair_angle':case 'ev3_motor_m':
      case 'ev3_motor':out.push({type:'motor',ports:Number(b.getFieldValue('PORTS')),speed:value(b,'SPEED'),degrees:value(b,'DEGREES'),mode:$('pairMode').value});break;
      case 'ev3_motor_l_single_time':case 'ev3_motor_l_pair_time':case 'ev3_motor_m_single_time':case 'ev3_motor_m_pair_time':case 'ev3_motor_m_time':out.push({type:'motorTimed',ports:Number(b.getFieldValue('PORTS')),speed:value(b,'SPEED'),seconds:value(b,'SECONDS')});break;
      case 'ev3_wait_seconds':out.push({type:'waitSeconds',seconds:value(b,'SECONDS')});break;
      case 'ev3_tread':out.push({type:'tread',mm:Number(b.getFieldValue('TREAD'))});break;
      case 'ev3_motor_speed_set':out.push({type:'motorSpeedSet',ports:Number(b.getFieldValue('PORTS')),speed:value(b,'SPEED')});break;
      case 'ev3_motor_power':out.push({type:'motorPower',ports:Number(b.getFieldValue('PORTS')),speed:value(b,'POWER')});break;
      case 'ev3_motor_stop_mode':out.push({type:'stopMode',ports:Number(b.getFieldValue('PORTS')),mode:b.getFieldValue('MODE')});break;
      case 'ev3_tank_angle':case 'ev3_tank_time':out.push({type:'tankFinite',action:b.type==='ev3_tank_angle'?'angle':'time',movement:true,leftSpeed:value(b,'LEFT_SPEED'),rightSpeed:value(b,'RIGHT_SPEED'),...(b.getInput('DEGREES')?{degrees:value(b,'DEGREES')}:{seconds:value(b,'SECONDS')})});break;
      case 'ev3_motor_l_single_rotation':case 'ev3_motor_l_pair_rotation':case 'ev3_motor_m_single_rotation':case 'ev3_motor_m_pair_rotation':out.push({type:'motorRotations',ports:Number(b.getFieldValue('PORTS')),speed:value(b,'SPEED'),rotations:value(b,'ROTATIONS'),mode:$('pairMode').value});break;
      case 'ev3_tank':out.push({type:'tank',movement:true,leftSpeed:value(b,'LEFT_SPEED'),rightSpeed:value(b,'RIGHT_SPEED')});break;
      case 'ev3_pivot_right':case 'ev3_pivot_left':out.push({type:'pivot',movement:true,speed:value(b,'SPEED'),angle:value(b,'ANGLE'),direction:b.type==='ev3_pivot_right'?'right':'left'});break;
      case 'ev3_spin_right':case 'ev3_spin_left':out.push({type:'spin',movement:true,speed:value(b,'SPEED'),angle:value(b,'ANGLE'),direction:b.type==='ev3_spin_right'?'right':'left'});break;
      case 'ev3_movement_setup':out.push({type:'movementSetup',leftPort:Number(b.getFieldValue('LEFT_PORT')),rightPort:Number(b.getFieldValue('RIGHT_PORT'))});break;
      case 'ev3_wheel':out.push({type:'wheel',diameter:Number(b.getFieldValue('DIAMETER'))});break;
      case 'ev3_drive_forward':case 'ev3_drive_backward':out.push({type:'drive',movement:true,speed:value(b,'SPEED'),cm:value(b,'CM'),direction:b.type==='ev3_drive_forward'?'forward':'backward',mode:$('pairMode').value});break;
      case 'ev3_display_clear':out.push({type:'displayClear'});break;
      case 'ev3_display_text':out.push({type:'displayBitmap',x:Number(b.getFieldValue('X')),y:Number(b.getFieldValue('Y')),bitmap:rasterDisplayText(b.getFieldValue('TEXT'),Number(b.getFieldValue('SIZE')))});break;
      case 'ev3_display_image':out.push({type:'displayBitmap',x:Number(b.getFieldValue('X')),y:Number(b.getFieldValue('Y')),bitmap:presetBitmap(b.getFieldValue('IMAGE'),Number(b.getFieldValue('SIZE')))});break;
      case 'ev3_display_number':out.push({type:'displayNumber',x:Number(b.getFieldValue('X')),y:Number(b.getFieldValue('Y')),font:Number(b.getFieldValue('FONT')),decimals:Number(b.getFieldValue('DECIMALS')),value:value(b,'VALUE')});break;
      case 'ev3_tone':out.push({type:'tone',frequency:value(b,'FREQUENCY'),ms:value(b,'MS'),volume:Number(b.getFieldValue('VOLUME'))});break;
      case 'ev3_wait':out.push({type:'wait',ms:value(b,'MS')});break;
      case 'ev3_pid_reset':out.push({type:'pidReset',name:b.getFieldValue('NAME')});break;
      case 'ev3_timer_reset':out.push({type:'timerReset'});break;
      case 'ev3_gyro_reset':out.push({type:'gyroReset',port:Number(b.getFieldValue('PORT'))});break;
      case 'ev3_encoder_reset':out.push({type:'encoderReset',port:Number(b.getFieldValue('PORT'))});break;
      case 'ev3_motor_stop':case 'ev3_stop_port':out.push({type:'stop',ports:Number(b.getFieldValue('PORTS')),...(b.getFieldValue('STOP_MODE')&&b.getFieldValue('STOP_MODE')!=='default'?{stopMode:b.getFieldValue('STOP_MODE')}:{})});break;
      case 'ev3_stop':out.push({type:'stop'});break;
      case 'ev3_program_end':out.push({type:'programEnd'});return out;
      case 'ev3_myblock_return':if(b.getRootBlock().type!=='procedures_defnoreturn')throw Error('「このマイブロックを終了する」はマイブロックの定義の中で使ってください。');out.push({type:'myblockReturn'});return out;
      case 'controls_repeat_ext':out.push({type:'repeat',count:value(b,'TIMES'),body:chain(b.getInputTargetBlock('DO'))});break;
      case 'procedures_callnoreturn':{
        const name=b.getProcedureCall();const def=Blockly.Procedures.getDefinition(name,workspace);
        if(!def)throw Error(`「${name}」の定義がありません。`);
        out.push({type:'call',name,args:def.getVarModels().map((_,i)=>value(b,`ARG${i}`))});break;
      }
      default:throw Error(`未対応のブロック: ${b.type}`);
    }
  }
  return out;
}
// スタート・イベントから到達する命令と、そこから呼ばれるマイブロックだけを集める。未接続の試作ブロックは転送対象に含めない。
function program(){
  const roots=workspace.getTopBlocks(true).filter(b=>b.isEnabled());
  const starts=roots.filter(b=>b.type==='ev3_start');
  const events=roots.filter(b=>['ev3_when_condition','ev3_when_changed','ev3_when_message'].includes(b.type));
  if(!starts.length&&!events.length)throw Error('「スタート」またはイベントのブロックを置いてください。');
  if(starts.length+events.length>16)throw Error('スタート・イベント・メッセージ受信は合計16個までです。');
  const main=starts.length?chain(starts[0].getNextBlock()):[],used=new Map();
  const threads=[...starts.slice(1).map((b,i)=>({kind:'start',name:'スタート'+(i+2),body:chain(b.getNextBlock())})),...events.map(b=>({kind:b.type==='ev3_when_message'?'message':b.type==='ev3_when_changed'?'changed':'condition',...(b.type==='ev3_when_message'?{message:b.getFieldValue('MESSAGE').trim()}:{condition:value(b,b.type==='ev3_when_changed'?'VALUE':'BOOL')}),body:chain(b.getNextBlock())}))];
  function gather(nodes){
    for(const node of nodes){
      if(node.type==='call' && !used.has(node.name)){
        const def=Blockly.Procedures.getDefinition(node.name,workspace);
        if(!def || !def.isEnabled())throw Error('呼び出しているマイブロックの定義を確認してください。');
        const procedure={name:node.name,params:def.getVarModels().map(m=>m.name),body:[]};
        used.set(node.name,procedure);procedure.body=chain(def.getInputTargetBlock('STACK'));gather(procedure.body);
      }
      for(const key of ['body','then','else'])if(node[key])gather(node[key]);
    }
  }
  gather(main);for(const t of threads)gather(t.body);
  return {main,procedures:[...used.values()],...(threads.length?{threads}:{} )};
}
// 読み込み・改名後の引数IDや表示を正規化する。Blocklyのイベントをまとめ、元に戻す操作を崩さない。
function ensureArgumentInputs(){
  const previousGroup=Blockly.Events.getGroup();
  Blockly.Events.setGroup(previousGroup || true);
  try{
    for(const block of workspace.getAllBlocks(false)){
      if(block.type==='variables_get'){
        const argument=localArgument(block),colour=argument?'#aa597e':'#c58245';
        if(block.getField('EV3_KIND'))block.inputList[0].removeField('EV3_KIND');
        if(block.getColour()!==colour)block.setColour(colour);
      }
      if(block.type==='ev3_argument'){
        const model=argumentModel(block);
        if(model)block.parameterId=model.getId();
        if(model && block.getFieldValue('ARG_NAME')!==model.name)block.setFieldValue(model.name,'ARG_NAME');
      }
      if(block.type!=='procedures_callnoreturn')continue;
      if(!block.getInputsInline())block.setInputsInline(true);
      for(const input of block.inputList){
        if(/^ARG\d+$/.test(input.name) && input.connection && !input.connection.targetBlock()){
          input.connection.setShadowState(input.connection.getShadowState(false) || {type:'math_number',fields:{NUM:0}});
        }
      }
    }
  }finally{Blockly.Events.setGroup(previousGroup);}
}
// 現在の作品を検証しRBFを生成する。失敗時はlastBuildを消し、以前の生成結果を誤って転送させない。
function check(){
  try{
    ensureArgumentInputs();
    lastBuild=compile(program(),$('ev3ProjectName').value);$('buildStatus').textContent='✓ 転送用プログラムを生成できます';$('buildStatus').className='build-status';
    $('buildDetails').textContent=`${lastBuild.data.length} バイト / マイブロック ${lastBuild.program.procedures.length} 個 / EV3標準形式${lastBuild.usesParallel?' / 並行 '+lastBuild.threadCount+' 処理':''}${lastBuild.usesRamps?' / 加減速（試作）':''}${lastBuild.usesFloat?' / 小数計算対応':''}${lastBuild.usesSensors?' / センサは本体実行時に読み取り':''}`;
  }catch(e){lastBuild=null;$('buildStatus').textContent=e.message;$('buildStatus').className='build-status error';$('buildDetails').textContent='ブロックを修正すると、自動で確認します。';}
  updateButtons();return lastBuild;
}

function exportMyBlockLibrary(){return createBlockLibrary(Blockly.serialization.workspaces.save(workspace),VERSION);}
// ライブラリを現在の作品に追加する。読み込みに失敗しても、既存の作品は控えから復元する。
function importMyBlockLibrary(data){
 const backup=Blockly.serialization.workspaces.save(workspace),merged=mergeBlockLibrary(backup,data);
 loading=true;
 try{Blockly.serialization.workspaces.load(merged,workspace);}
 catch(error){Blockly.serialization.workspaces.load(backup,workspace);throw error;}
 finally{loading=false;}
 workspace.clearUndo();dirty=true;check();saveLocal();
}

// 編集用保存形式（.ev3lab）。Blocklyの配置や未接続ブロックも含み、EV3用の.rbfとは用途が異なる。
function project(){return {format:'ev3-block-lab',version:1,appVersion:VERSION,name:$('programName').value,programName:$('programName').value,ev3ProjectName:$('ev3ProjectName').value,pairMode:$('pairMode').value,workspace:Blockly.serialization.workspaces.save(workspace)};}
// 保存形式を確認して復元する。古い作品の保存先名・プログラム名がない場合は既定値を使う。
function restore(data){
  if(data?.format!=='ev3-block-lab' || data.version!==1 || !data.workspace?.blocks)throw Error('EV3 Block Labのプロジェクト（バージョン1）を選んでください。');
  inspectBlocks(data.workspace.blocks);
  const oldMovement=/\"type\":\s*\"ev3_(?:drive_|spin_|pivot_|steering_|tank)/.test(JSON.stringify(data.workspace))&&!JSON.stringify(data.workspace).includes('ev3_movement_setup');
  const backup=Blockly.serialization.workspaces.save(workspace);
  loading=true;
  try{Blockly.serialization.workspaces.load(data.workspace,workspace);}
  catch(e){Blockly.serialization.workspaces.load(backup,workspace);throw e;}
  finally{loading=false;}
  $('ev3ProjectName').value=typeof data.ev3ProjectName==='string'?data.ev3ProjectName:'EV3Lab';
  $('programName').value=typeof data.programName==='string'?data.programName:'MyProgram';
  $('pairMode').value=['sync','feedback'].includes(data.pairMode)?data.pairMode:'independent';
  workspace.clearUndo();check();
  if(oldMovement)feedback('以前の作品です。「動きに使うモーター」を追加し、左右の配線を再確認してください。B+Cは自動設定しません。',true);
  return oldMovement;
}
// 復元中の一時状態は保存しない。容量不足などで失敗した場合は、ファイル保存を促す表示にする。
function saveLocal(){
  if(loading)return;
  try{localStorage.setItem(STORAGE,JSON.stringify(project()));$('saveState').textContent='✓ この端末に自動保存済み';}
  catch{$('saveState').textContent='自動保存できません。「保存」でファイルを保存してください。';}
}
function download(data,name,type='application/octet-stream'){
  const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function feedback(message,error=false){$('transferResult').textContent=message;$('transferResult').className=`result ${error?'error':''}`;}
const n=(name,val)=>`<value name="${name}"><shadow type="math_number"><field name="NUM">${val}</field></shadow></value>`;
const arg=(name)=>`<block type="variables_get"><field name="VAR" id="arg-${name}">${name}</field></block>`;
// 授業・実機確認用のサンプルを生成する。サンプルへの置き換えは呼び出し側で未保存変更を確認する。
function sample(mode){
  const motor=mode==='motor',proc=motor?'角度を指定して回す':'合図する',params=motor?['角度','速度']:['周波数'];
  const call=(values,next='')=>`<block type="procedures_callnoreturn"><mutation name="${proc}">${params.map(p=>`<arg name="${p}"></arg>`).join('')}</mutation>${values.map((v,i)=>n(`ARG${i}`,v)).join('')}${next?`<next>${next}</next>`:''}</block>`;
  const second=call(motor?[180,30]:[880]);
  const wait=`<block type="ev3_wait_seconds">${n('SECONDS',.5)}<next>${second}</next></block>`;
  const body=motor?`<block type="ev3_motor"><field name="PORTS">2</field><value name="SPEED">${arg('速度')}</value><value name="DEGREES">${arg('角度')}</value></block>`:`<block type="ev3_tone"><field name="VOLUME">25</field><value name="FREQUENCY">${arg('周波数')}</value>${n('MS',250)}</block>`;
  const xml=`<xml xmlns="https://developers.google.com/blockly/xml"><variables>${params.map(p=>`<variable id="arg-${p}">${p}</variable>`).join('')}</variables><block type="ev3_start" x="30" y="35"><next>${call(motor?[90,20]:[440],wait)}</next></block><block type="procedures_defnoreturn" x="30" y="410"><mutation>${params.map(p=>`<arg name="${p}" varid="arg-${p}"></arg>`).join('')}</mutation><field name="NAME">${proc}</field><statement name="STACK">${body}</statement></block></xml>`;
  loading=true;
  try{workspace.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml),workspace);$('programName').value=motor?'MotorSample':'SoundSample';workspace.clearUndo();}
  finally{loading=false;}
  check();saveLocal();dirty=false;
}
function replaceSample(mode){if(dirty && !confirm('現在の編集内容をサンプルに置き換えます。必要な場合は先に「保存」してください。'))return;sample(mode);feedback('サンプルを読み込みました。');}
workspace.addChangeListener(e=>{
  if(loading || e.isUiEvent)return;
  dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(()=>{check();saveLocal();},350);
});
$('ev3ProjectName').addEventListener('input',()=>{dirty=true;check();saveLocal();});
$('programName').addEventListener('input',()=>{dirty=true;updateButtons();saveLocal();});
$('pairMode').onchange=()=>{dirty=true;check();saveLocal();feedback('2モーターの制御方式を変更しました。反映するには再転送が必要です。');};
$('readTiming').onclick=async()=>{
  const build=check();if(!build?.diagnosticPath)return;
  busy=true;updateButtons();$('timingResult').textContent='EV3に保存された停止時刻を読み取っています…';
  try{
    const record=await connection.readTimingRecord(build.diagnosticPath,build.diagnosticTag);
    const signature=JSON.stringify(record);
    const same=signature===lastTimingSignature;lastTimingSignature=signature;
    const seconds=n=>n<0?'未完了':`${(n/1000).toFixed(3)}秒`;
    const delta=record.deltaMs;
    const difference=delta===null?'停止時刻の差は未確定です。':delta===0?'観測上の停止時刻は同じです。':`${record.ports[delta>0?1:0]}が${seconds(Math.abs(delta))}遅く完了しました。`;
    $('timingResult').className=`result${record.timedOut?' error':''}`;
    $('timingResult').textContent=`${same?'前回と同じ記録です。':'最後の補正ブロックの記録：'}${record.ports.map((p,i)=>`${p} ${seconds(record.stopMs[i])}・${record.degrees[i]}°`).join(' / ')}。${difference}${record.timedOut?'時間切れで停止しました。':''}途中の通過時刻は通信ログに記録しました。`;
  }catch(e){$('timingResult').className='result error';$('timingResult').textContent=e.message;log('エラー',e.message);}
  finally{busy=false;updateButtons();}
};
$('recordCounts').onclick=async()=>{
  busy=true;updateButtons();
  try{baselineCounts=await connection.readMotorCounts();$('countResult').className='result';$('countResult').textContent=`開始角度を記録しました（B ${baselineCounts.B}° / C ${baselineCounts.C}°）。本体で今回のファイルを1回実行し、停止後に「終了角度を読む」を押してください。`;log('計測開始',JSON.stringify({counts:baselineCounts,mode:$('pairMode').value,file:savedPath||'本体で選択したファイル'}));}
  catch(e){baselineCounts=null;$('countResult').className='result error';$('countResult').textContent=e.message;log('エラー',e.message);}
  finally{busy=false;updateButtons();}
};
$('readCounts').onclick=async()=>{
  busy=true;updateButtons();
  try{const current=await connection.readMotorCounts();const delta={B:(current.B-baselineCounts.B)|0,C:(current.C-baselineCounts.C)|0};$('countResult').className='result';$('countResult').textContent=`開始からの回転角度：B ${delta.B}° / C ${delta.C}°（本体の角度センサー値）。`;log('計測結果',JSON.stringify({start:baselineCounts,end:current,degrees:delta}));}
  catch(e){$('countResult').className='result error';$('countResult').textContent=e.message;log('エラー',e.message);}
  finally{busy=false;updateButtons();}
};
$('check').onclick=()=>{check();};
$('spinSample').onclick=()=>{
 if(dirty && !confirm('現在の編集内容をスピンターンのサンプルに置き換えます。必要なら先に保存してください。'))return;
 const number=n=>({block:{type:'math_number',fields:{NUM:n}}});
 const turn=direction=>({type:'ev3_spin_'+direction,fields:{LEFT_PORT:'2',RIGHT_PORT:'4'},inputs:{SPEED:number(20),ANGLE:number(90)}});
 const left=turn('left'),wait={type:'ev3_wait_seconds',inputs:{SECONDS:number(1)},next:{block:left}},right={...turn('right'),next:{block:wait}};
 const first={type:'ev3_start',next:{block:{type:'ev3_wheel',fields:{DIAMETER:56},next:{block:{type:'ev3_tread',fields:{TREAD:112},next:{block:right}}}}}};
 loading=true;try{Blockly.serialization.workspaces.load(movementSampleState({blocks:{languageVersion:0,blocks:[first]}}),workspace);$('programName').value='SpinTurn';workspace.clearUndo();}finally{loading=false;}check();saveLocal();dirty=false;feedback('直径56mm・トレッド112mmの例です。実物の寸法と左右のポートに合わせて変更してください。');
};
$('sensorMotorSample').onclick=()=>{
 if(dirty && !confirm('現在の編集内容を距離で停止のサンプルに置き換えます。必要なら先に保存してください。'))return;
 const stop={type:'ev3_stop'},wait={type:'ev3_wait_until',inputs:{BOOL:{block:{type:'ev3_distance_compare',fields:{PORT:'4',OP:'lt'},inputs:{VALUE:shadow(15)}}}},next:{block:stop}};
 const run={type:'ev3_motor_l_run',fields:{PORTS:'6'},inputs:{SPEED:shadow(20)},next:{block:wait}};
 loading=true;try{Blockly.serialization.workspaces.load({blocks:{languageVersion:0,blocks:[{type:'ev3_start',x:80,y:60,next:{block:run}}]}},workspace);$('programName').value='DistanceStop';workspace.clearUndo();}finally{loading=false;}
 check();saveLocal();dirty=false;feedback('LモーターB+Cを速さ20％で回し、ポート4の超音波センサが15cm未満になったら停止します。');
};
$('colorSample').onclick=()=>{
 if(dirty && !confirm('現在の編集内容を赤で音のサンプルに置き換えます。必要なら先に保存してください。'))return;
 loading=true;
 try{Blockly.serialization.workspaces.load({blocks:{languageVersion:0,blocks:[{type:'ev3_start',x:80,y:60,next:{block:{type:'ev3_wait_until',inputs:{BOOL:{block:{type:'ev3_color_is',fields:{PORT:'3',COLOR:'5'}}}},next:{block:{type:'ev3_tone',fields:{VOLUME:25},inputs:{FREQUENCY:shadow(880),MS:shadow(300)}}}}}}]}},workspace);$('programName').value='ColorSound';workspace.clearUndo();}
 finally{loading=false;}
 check();saveLocal();dirty=false;feedback('カラーセンサをポート3に接続し、赤い物を近づけると音が鳴ります。');
};
$('controlSample').onclick=()=>{
 if(dirty && !confirm('現在の編集内容を変数と分岐のサンプルに置き換えます。必要なら先に保存してください。'))return;
 const number=n=>({block:{type:'math_number',fields:{NUM:n}}}),variable=()=>({block:{type:'variables_get',fields:{VAR:{id:'sample-count'}}}});
 const tone=frequency=>({block:{type:'ev3_tone',fields:{VOLUME:25},inputs:{FREQUENCY:number(frequency),MS:number(200)}}});
 const branch={type:'controls_if',extraState:{hasElse:true},inputs:{IF0:{block:{type:'logic_compare',fields:{OP:'EQ'},inputs:{A:variable(),B:number(2)}}},DO0:tone(880),ELSE:tone(440)},next:{block:{type:'ev3_wait_seconds',inputs:{SECONDS:number(.5)}}}};
 const repeat={type:'controls_whileUntil',fields:{MODE:'WHILE'},inputs:{BOOL:{block:{type:'logic_compare',fields:{OP:'LT'},inputs:{A:variable(),B:number(3)}}},DO:{block:{type:'math_change',fields:{VAR:{id:'sample-count'}},inputs:{DELTA:number(1)},next:{block:branch}}}}};
 const first={type:'ev3_start',next:{block:{type:'variables_set',fields:{VAR:{id:'sample-count'}},inputs:{VALUE:number(0)},next:{block:repeat}}}};
 loading=true;try{Blockly.serialization.workspaces.load({variables:[{id:'sample-count',name:'回数'}],blocks:{languageVersion:0,blocks:[first]}},workspace);$('programName').value='Variables';workspace.clearUndo();}finally{loading=false;}check();saveLocal();dirty=false;feedback('回数を1ずつ増やし、2回目だけ高い音を鳴らします。');
};
$('driveSample').onclick=()=>{
 if(dirty && !confirm('現在の編集内容を走行サンプルに置き換えます。必要なら先に保存してください。'))return;
 const move=(direction)=>'<block type="ev3_drive_'+direction+'"><field name="PORTS">6</field>'+n('SPEED',20)+n('CM',20)+'</block>';
 const xml='<xml xmlns="https://developers.google.com/blockly/xml"><block type="ev3_start" x="30" y="35"><next><block type="ev3_wheel"><field name="DIAMETER">56</field><next>'+move('forward').replace('</block>','<next><block type="ev3_wait_seconds">'+n('SECONDS',1)+'<next>'+move('backward')+'</next></block></next></block>')+'</next></block></next></block></xml>';
 loading=true;try{workspace.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml),workspace);const state=movementSampleState(Blockly.serialization.workspaces.save(workspace));Blockly.serialization.workspaces.load(state,workspace);$('programName').value='ForwardBackward';workspace.clearUndo();}finally{loading=false;}check();saveLocal();dirty=false;feedback('タイヤ直径56mm・B+C・前後20cmのサンプルです。実物の直径を確認してください。');
};
$('soundSample').onclick=()=>replaceSample('sound');$('motorSample').onclick=()=>replaceSample('motor');
$('undo').onclick=()=>workspace.undo(false);$('redo').onclick=()=>workspace.undo(true);
$('zoomToFit').onclick=()=>{
 // パレットを閉じて編集領域全体を使う。ブロックの配置・接続は変更しない。
 workspace.getToolbox()?.clearSelection();Blockly.svgResize(workspace);
 if(!workspace.getAllBlocks(false).length)return;
 // 大きく離れたブロックも収め、拡大操作でその倍率から戻れるようにする。
 const zoom=workspace.options.zoomOptions,minimum=zoom.minScale;
 try{zoom.minScale=Number.EPSILON;workspace.zoomToFit();}
 finally{zoom.minScale=Math.min(minimum,workspace.scale);}
};
$('help').onclick=()=>$('helpDialog').showModal();
$('newProject').onclick=()=>{
 if(workspace.getAllBlocks(false).length && !confirm('新しいプログラムを作ります。現在のプログラムが必要な場合は、先に「保存」してください。'))return;
 loading=true;
 try{Blockly.serialization.workspaces.load({blocks:{languageVersion:0,blocks:[{type:'ev3_start',x:30,y:35}]}},workspace);$('ev3ProjectName').value='EV3Lab';$('programName').value='MyProgram';workspace.clearUndo();}
 finally{loading=false;}
 savedPath='';dirty=false;check();saveLocal();feedback('新しいプログラムを作りました。マイブロックの読み込みもできます。');
};
$('exportMyBlocks').onclick=()=>{try{const library=exportMyBlockLibrary();download(JSON.stringify(library,null,2),'my-blocks.ev3blocks','application/json');feedback(library.definitions.length+'個のマイブロックを書き出しました。');}catch(e){feedback(e.message,true);}};
$('importMyBlocks').onclick=()=>$('libraryFileInput').click();
$('libraryFileInput').onchange=async e=>{
 const file=e.target.files[0];e.target.value='';if(!file)return;
 try{if(file.size>2*1024*1024)throw Error('ファイルは2MB以下にしてください。');const data=JSON.parse(await file.text());importMyBlockLibrary(data);feedback(data.definitions.length+'個のマイブロックを追加しました。定義は編集画面の下側にあります。');}
 catch(error){feedback('読み込めませんでした。'+error.message,true);}
};
// 台形とS字を同じモーター条件で比較するための編集データを作る。実機ではタイヤ等の構成も確認する。
function rampSampleState(){
 const number=n=>({shadow:{type:'math_number',fields:{NUM:n}}});
 const motor=()=>({block:{type:'ev3_motor_l_single_angle',fields:{PORTS:'2'},inputs:{SPEED:number(30),DEGREES:number(720)}}});
 const setting=mode=>({block:{type:'ev3_ramp',fields:{MODE:mode},inputs:{UP:number(1),DOWN:number(1)}}});
 const first=setting('trapezoid'),a=motor(),wait={block:{type:'ev3_wait_seconds',inputs:{SECONDS:number(1)}}},second=setting('scurve'),b=motor();
 first.block.next=a;a.block.next=wait;wait.block.next=second;second.block.next=b;
 return {blocks:{languageVersion:0,blocks:[{type:'ev3_start',x:30,y:30,next:first}]}};
}
function loadRampSample(){
 loading=true;try{Blockly.serialization.workspaces.load(rampSampleState(),workspace);$('programName').value='RampTest';workspace.clearUndo();}finally{loading=false;}
 check();saveLocal();dirty=false;feedback('LモーターBを台形→1秒待つ→S字の順に720度ずつ回します。速度30％、加速・減速各1秒です。実機確認をお願いします。');
}
$('rampSample').onclick=()=>{if(dirty)$('rampSampleDialog').showModal();else loadRampSample();};
$('rampSampleCancel').onclick=()=>$('rampSampleDialog').close();
$('rampSampleConfirm').onclick=()=>{$('rampSampleDialog').close();loadRampSample();};
$('saveProject').onclick=()=>{try{const filename=programFileName($('programName').value).replace(/\.rbf$/,'.ev3lab');download(JSON.stringify(project(),null,2),filename,'application/json');dirty=false;}catch(e){feedback(e.message,true);$('programName').focus();}};
$('loadProject').onclick=()=>$('fileInput').click();
$('fileInput').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{if(file.size>2*1024*1024)throw Error('プロジェクトは2MB以下にしてください。');const data=JSON.parse(await file.text());
    if(dirty && !confirm('現在の編集内容をファイルの内容に置き換えますか？'))return;
    const needsMovement=restore(data);saveLocal();dirty=false;if(!needsMovement)feedback('プロジェクトを読み込みました。');
  }catch(e){feedback(`読み込めませんでした。${e.message}`,true);}
};
let savedPath='';
$('connect').onclick=async()=>{
  const method=$('connectionMethod').value;
  busy=true;updateButtons();feedback(method==='usb'?'USBケーブルをEV3のPC端子につなぎ、選択画面でEV3を選んでください。':'EV3のBluetoothシリアルポートを選んでください。');
  try{await connection.connect(method);const fw=await connection.ping();$('brickLabel').textContent=`${method==='usb'?'USB':'Bluetooth'} / EV3 / ${fw || '標準ファームウェア'}`;feedback('EV3を確認しました。「転送・照合」で本体に保存できます。');}
  catch(e){log('エラー',`${e.name}: ${e.message}`);feedback(e.name==='NotFoundError'?'接続先の選択をキャンセルしました。':e.name==='SecurityError'||e.name==='NotAllowedError'?'接続が許可されませんでした。Chromeでサイトを直接開き、サイトや学校の端末の接続許可を確認してください。'+e.message:e.message,true);await connection.close();}
  finally{busy=false;updateButtons();}
};
$('disconnect').onclick=async()=>{busy=true;updateButtons();await connection.close();feedback(savedPath?`切断しました。EV3を再起動して、${savedPath.split('/').slice(-2).join(' → ')} を選んでください。`:'切断しました。');busy=false;updateButtons();};
// EV3用ファイル名は入力したプログラム名から作り、拡張子.rbfを自動で付ける。
function fileName(){
  return programFileName($('programName').value);
}
async function transferProgram(run=false){
  const build=check();if(!build)return;
  let filename;try{filename=fileName();}catch(e){feedback(e.message,true);return;}
  stopSensorMonitor();busy=true;updateButtons();$('progress').hidden=false;$('progress').value=0;feedback(`「${filename}」を保存しています。同じ名前のプログラムは上書きされます…`);
  try{
    log('プログラム',JSON.stringify({name:$('programName').value,filename,ir:build.program}));
    savedPath='';
    const result=await connection[run?'transferAndRun':'transferWithSignal'](build.data,filename,p=>{$('progress').value=p;feedback(p===100?'送信完了。EV3から読み戻して照合しています…':`本体に保存しています… ${p}%`);},$('ev3ProjectName').value);
    savedPath=result.path;
    $('transferResult').className='result success';$('transferResult').textContent=`✓ 照合完了（${build.data.length}バイト一致）。保存先：${savedPath.split('/').slice(-2).join(' → ')}。${result.soundError?'完了音は確認できませんでしたが、転送・照合は完了しています（'+result.soundError+'）。':'EV3へ完了音を送信しました。'}${run?'今回のプログラムの起動命令を送信しました。止めるときは「実行を停止」を押してください。':'本体でこのプログラムを選んで実行してください。'}`;
  }catch(e){if(e.verifiedPath)savedPath=e.verifiedPath;log('エラー',e.message);feedback(e.verifiedPath?`転送・照合は完了していますが、起動を確認できません。${e.message}`:`転送未完了：${e.message}`,true);}
  finally{busy=false;$('progress').hidden=true;updateButtons();}
};
$('transfer').onclick=()=>transferProgram(false);
$('transferRun').onclick=()=>transferProgram(true);
$('stopProgram').onclick=async()=>{stopSensorMonitor();busy=true;updateButtons();try{await connection.stopProgram();feedback('EV3へプログラムと全モーターの停止命令を送信しました。');}catch(e){feedback('停止を確認できません。本体の戻るボタンで停止してください。'+e.message,true);}finally{busy=false;updateButtons();}};
$('downloadRbf').onclick=()=>{const b=check();if(b){try{download(b.data,fileName());log('ファイル生成',`${b.data.length} bytes / ${hex(b.data.slice(0,28))}`);feedback('.rbfを保存しました。ファイルの保存だけではEV3への転送は完了していません。');}catch(e){feedback(e.message,true);}}};
$('toggleLog').onclick=()=>{const open=$('logContent').hidden;$('logContent').hidden=!open;$('toggleLog').setAttribute('aria-expanded',String(open));};
$('clearLog').onclick=()=>{logs.length=0;$('log').textContent='';$('lastLog').textContent='ログを消去しました';};
$('saveLog').onclick=()=>download(JSON.stringify({appVersion:VERSION,time:new Date().toISOString(),userAgent:navigator.userAgent,secureContext:isSecureContext,serialSupported:!!navigator.serial,hidSupported:!!navigator.hid,connectionMethod:connection.transport,project:project(),log:logs},null,2),'ev3-test-log.json','application/json');
new ResizeObserver(()=>Blockly.svgResize(workspace)).observe($('blocklyDiv'));
function updateConnectionInfo(){
 const usb=$('connectionMethod').value==='usb';
 $('environment').textContent=!isSecureContext?'HTTPSで開いてください。':usb?(!navigator.hid?'USB接続に非対応です。パソコン／ChromebookのChromeで開いてください。':'USBケーブルをEV3のPC端子につないでください。接続時にEV3を選択します。学校の端末では利用許可が必要な場合があります。'):(!navigator.serial?'Bluetooth接続に非対応です。Chromeで開いてください。':'Windows／ChromebookのBluetooth設定でEV3をペアリングし、シリアルポートを選びます。');
 if(!connection.connected)$('brickLabel').textContent=(usb?'USB':'Bluetooth')+' / 標準EV3';
 updateButtons();
}
$('connectionMethod').onchange=()=>updateConnectionInfo();updateConnectionInfo();
try{const data=localStorage.getItem(STORAGE);if(data){restore(JSON.parse(data));log('編集','自動保存したプロジェクトを復元しました。');}else sample('sound');}
catch(e){sample('sound');log('補足',`保存データを復元できなかったため、サンプルを読み込みました。${e.message}`);}
dirty=false;check();
// QA entry point: read-only data and editor handle for browser-based checks.
window.ev3Lab={workspace,compile:()=>compile(program(),$('ev3ProjectName').value),getProject:project,version:VERSION};

let editingMyBlockId=null;
function myBlockArgumentRow(name='',id=''){
 const row=document.createElement('div');row.className='myblock-argument';row.dataset.parameterId=id;
 const input=document.createElement('input');input.value=name;input.maxLength=40;input.placeholder='例：距離';input.setAttribute('aria-label','引数の名前');
 const remove=document.createElement('button');remove.type='button';remove.textContent='削除';remove.onclick=()=>row.remove();
 row.append(input,remove);$('myBlockArguments').append(row);
}
function openMyBlockDialog(id=null){
 editingMyBlockId=id;const def=id?workspace.getBlockById(id):null;
 $('myBlockTitle').textContent=def?'マイブロックを編集':'マイブロックを作る';
 $('myBlockName').value=def?.getFieldValue('NAME')??'';$('myBlockArguments').replaceChildren();$('myBlockError').textContent='';
 for(const m of def?.getVarModels()??[])myBlockArgumentRow(m.getName(),m.getId());
 $('myBlockSubmit').textContent=def?'変更を保存':'作る';$('myBlockDialog').showModal();$('myBlockName').focus();
}
$('createMyBlock').onclick=()=>openMyBlockDialog();
$('myBlockAddArgument').onclick=()=>{if($('myBlockArguments').children.length>=8){$('myBlockError').textContent='引数は8個までです。';return;}myBlockArgumentRow();$('myBlockArguments').lastElementChild.querySelector('input').focus();};
$('myBlockCancel').onclick=()=>$('myBlockDialog').close();
$('myBlockForm').onsubmit=event=>{
 event.preventDefault();
 try{const rows=[...$('myBlockArguments').children].map(row=>({id:row.dataset.parameterId,name:row.querySelector('input').value}));
  const def=saveMyBlock(workspace,$('myBlockName').value,rows,editingMyBlockId);
  ensureArgumentInputs();workspace.refreshToolboxSelection();dirty=true;check();saveLocal();$('myBlockDialog').close();workspace.centerOnBlock(def.id);
  feedback('定義の中に命令をつなぎ、マイブロックの同じ名前のブロックをスタートにつなげて使います。');
 }catch(error){$('myBlockError').textContent=error.message;}
};

function openVariableDialog(){
 $('variableName').value='';$('variableError').textContent='';$('variableDialog').showModal();$('variableName').focus();
}
$('variableCancel').onclick=()=>$('variableDialog').close();
$('variableForm').onsubmit=event=>{
 event.preventDefault();
 try{createOrdinaryVariable(workspace,$('variableName').value);workspace.refreshToolboxSelection();dirty=true;saveLocal();$('variableDialog').close();feedback('「変数」グループに変数のブロックを追加しました。');}
 catch(error){$('variableError').textContent=error.message;}
};

// Classroom layout: connection tools overlay the canvas only when requested.
// 接続設定は編集領域の上に開く。閉じたときにキャンバスを広く使えるようにする。
function showConnectionPanel(open){
 $('connectionPanel').hidden=!open;$('toggleConnectionPanel').setAttribute('aria-expanded',String(open));
 if(open)$('closeConnectionPanel').focus();else $('toggleConnectionPanel').focus();
}
$('toggleConnectionPanel').onclick=()=>showConnectionPanel($('connectionPanel').hidden);
$('closeConnectionPanel').onclick=()=>showConnectionPanel(false);
for(const menu of document.querySelectorAll('.toolbar-menu')){
 menu.addEventListener('click',event=>{if(event.target.closest('button'))menu.open=false;});
 menu.addEventListener('toggle',()=>{if(menu.open)for(const other of document.querySelectorAll('.toolbar-menu'))if(other!==menu)other.open=false;});
}
document.addEventListener('click',event=>{if(!event.target.closest('.toolbar-menu'))for(const menu of document.querySelectorAll('.toolbar-menu'))menu.open=false;});
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape'||document.querySelector('dialog[open]'))return;
 const menu=document.querySelector('.toolbar-menu[open]');
 if(menu){menu.open=false;menu.querySelector('summary').focus();return;}
 if(!$('connectionPanel').hidden)showConnectionPanel(false);
});


function stopSensorMonitor(){clearTimeout(monitorTimer);monitorTimer=null;$('autoSensors').checked=false;}
function clearSensorValues(){for(let p=1;p<=4;p++){$('sensorValue'+p).textContent='—';$('sensorLabel'+p).textContent='未取得';$('sensorDevice'+p).textContent='';}for(const p of 'ABCD'){$('motorValue'+p).textContent='—';$('motorLabel'+p).textContent='未取得';}$('sensorMonitorStatus').textContent='接続して「値を読む」を押してください。';}
// 監視も転送と同じ通信経路を使うためbusyで排他する。読み取り完了後に次回を予約し、通信を重ねない。
// この表示更新は接続中だけの機能。転送したプログラム内のセンサ判定はEV3本体で独立して動く。
async function refreshSensorValues(){
 if(!connection.connected||busy){if($('autoSensors').checked)monitorTimer=setTimeout(refreshSensorValues,500);return;}
 busy=true;updateButtons();$('sensorMonitorStatus').textContent='読み取っています…';
 try{const snapshot=await connection.readSensorSnapshot();for(const input of snapshot.inputs){const reading=sensorReading(input);$('sensorDevice'+input.port).textContent=deviceName(input.type);$('sensorLabel'+input.port).textContent=reading.label;$('sensorValue'+input.port).textContent=reading.text;}for(const motor of snapshot.motors){$('motorValue'+motor.port).textContent=motor.value===null?'—':motor.value+'°';$('motorLabel'+motor.port).textContent=deviceName(motor.type);}$('sensorMonitorStatus').textContent='更新 '+new Date().toLocaleTimeString();}
 catch(e){stopSensorMonitor();clearSensorValues();$('sensorMonitorStatus').textContent='読み取れませんでした。'+e.message;}
 finally{busy=false;updateButtons();if($('autoSensors').checked&&connection.connected)monitorTimer=setTimeout(refreshSensorValues,500);}
}
$('readSensors').onclick=()=>refreshSensorValues();
$('autoSensors').onchange=()=>{clearTimeout(monitorTimer);monitorTimer=null;if($('autoSensors').checked)void refreshSensorValues();};

// 本体ログの読み出し中は測定の自動更新を止め、同じ通信経路を順番に使う。
$('exportCsv').onclick=async()=>{if(busy||!connection.connected)return;stopSensorMonitor();busy=true;updateButtons();$('csvStatus').textContent='EV3からCSVを読み出しています…';try{const file=$('csvName').value.trim(),csv=await connection.readCsv($('ev3ProjectName').value,file);download('\ufeff'+csv,file+'.csv','text/csv;charset=utf-8');$('csvStatus').textContent='CSVを保存しました。EV3本体の記録は残っています。';}catch(e){$('csvStatus').textContent=e.message;}finally{busy=false;updateButtons();}};

async function loadFeatureSample(name){
 if(dirty&&!confirm('編集内容をサンプルに置き換えます。必要な場合は先に保存してください。'))return;
 try{const response=await fetch('samples/'+name+'.ev3lab');if(!response.ok)throw Error('サンプルを読み込めません。');restore(await response.json());$('fileMenu').open=false;check();saveLocal();dirty=false;feedback('サンプルを読み込みました。ログ名はLogです。ステアリングの例は転送して実行すると走行します。');}catch(e){feedback(e.message,true);}
}
$('sampleData').onclick=()=>loadFeatureSample('DataLogTest');
$('sampleSteering').onclick=()=>loadFeatureSample('SteeringTest');

for(const [id,kind,name]of [['parallelSample','parallel','ParallelMeasure'],['eventSample','event','TouchEvent'],['messageSample','message','MessageRelay']])$(id).onclick=()=>{
 if(dirty&&!confirm('編集中の内容をサンプルに置き換えます。必要なら先に保存してください。'))return;
 loading=true;try{Blockly.serialization.workspaces.load(parallelSampleState(kind),workspace);$('programName').value=name;workspace.clearUndo();}finally{loading=false;}
 check();saveLocal();dirty=false;$('sampleMenu').open=false;
 feedback(kind==='parallel'?'B+Cの走行と、超音波センサ2のCSV記録を並行します。ログ名はParallelです。':kind==='event'?'B+Cを回し続け、タッチセンサ1で全体を停止します。本体の戻るボタンでも停止できます。':'「測定」を送って待ち、超音波センサ2をCSVに記録します。ログ名はMessageです。');
};

for(const [id,kind,name]of [['motorStopSample','stop','MotorStopTest'],['tankFiniteSample','tank','TankFiniteTest'],['motorPowerSample','power','MotorPowerTest']])$(id).onclick=()=>{
 if(dirty&&!confirm('編集内容をモーターのサンプルに置き換えます。必要なら先に保存してください。'))return;
 loading=true;try{Blockly.serialization.workspaces.load(motorSampleState(kind),workspace);$('programName').value=name;workspace.clearUndo();}finally{loading=false;}
 check();saveLocal();dirty=false;$('sampleMenu').open=false;
 feedback(kind==='stop'?'モーターBを惰性→ブレーキ→保持の順で各0.25回転し、1秒ずつ待ちます。':kind==='tank'?'B+Cを左30％・右15％で速い側180度、次に左右逆回転で0.5秒動かします。':'モーターBの速度指定20％→30％→パワー20％を比較し、実測速度をCSV（Power）に記録します。');
};

// 表示は次の命令へすぐ進む。観察用サンプルでは最後に待ち時間を置く。
function displaySampleState(){
 const blocks=[{type:'ev3_display_clear'},{type:'ev3_display_text',fields:{TEXT:'こんにちは EV3',X:0,Y:4,SIZE:'16'}},{type:'ev3_display_image',fields:{IMAGE:'smile',X:64,Y:34,SIZE:'48'}},{type:'ev3_display_number',fields:{X:48,Y:94,FONT:'0',DECIMALS:1},inputs:{VALUE:{block:{type:'ev3_timer'}}}},{type:'ev3_wait_seconds',inputs:{SECONDS:shadow(5)}}];
 for(let i=0;i<blocks.length-1;i++)blocks[i].next={block:blocks[i+1]};
 return {blocks:{languageVersion:0,blocks:[{type:'ev3_start',x:40,y:35,next:{block:blocks[0]}}]}};
}
$('displaySample').onclick=()=>{
 if(dirty&&!confirm('編集中の内容を「本体画面の表示」に置き換えます。必要な作品は先に保存してください。'))return;
 loading=true;try{Blockly.serialization.workspaces.load(displaySampleState(),workspace);$('programName').value='DisplayTest';workspace.clearUndo();}finally{loading=false;}
 check();saveLocal();dirty=false;$('sampleMenu').open=false;
};

$('gyroSample').onclick=()=>{
 if(dirty&&!confirm('編集中の内容を「ジャイロの角度・回転速度」に置き換えます。必要な作品は先に保存してください。'))return;
 loading=true;try{Blockly.serialization.workspaces.load(gyroSampleState(),workspace);$('programName').value='GyroTest';workspace.clearUndo();}finally{loading=false;}
 check();saveLocal();dirty=false;$('sampleMenu').open=false;
 feedback('ジャイロをポート1に接続して静止させてください。開始音の後、約10秒間、手で向きを変えると角度・回転速度を画面表示しCSVに記録します。');
};

for(const [id,kind,name]of [['batterySample','battery','BatteryTest'],['pidSample','pid','PIDTest']])$(id).onclick=()=>{
 if(dirty&&!confirm('編集中の内容をサンプルに置き換えます。必要なら先に保存してください。'))return;
 loading=true;try{Blockly.serialization.workspaces.load(powerPidSampleState(kind),workspace);$('programName').value=name;workspace.clearUndo();}finally{loading=false;}
 check();saveLocal();dirty=false;$('sampleMenu').open=false;
 feedback(kind==='battery'?'バッテリー全体の電圧・電流を画面表示し、ログBatteryへ記録します。モーターは動かしません。':'目標10・測定4の固定値でPIDを10回計算し、ログPIDへ記録します。モーターは動かしません。');
};

for(const [id,kind,name]of [['movementBasicSample','basic','MovementBasic'],['movementSwitchSample','switch','MovementSwitch'],['movementMyBlockSample','myblock','MovementMyBlock']])$(id).onclick=()=>{
 if(dirty&&!confirm('現在の編集内容を共通モーター設定のサンプルに置き換えます。必要なら先に保存してください。'))return;
 loading=true;try{Blockly.serialization.workspaces.load(commonMovementSampleState(kind),workspace);$('programName').value=name;$('pairMode').value='feedback';workspace.clearUndo();}finally{loading=false;}
 check();saveLocal();dirty=false;feedback(kind==='switch'?'左B・右Cで前進後、旧組を停止して左A・右Dへ切替え、後退します。4個の実機配線を確認してから実行してください。':'左B・右Cをスタート直後に設定します。実際の配線・直径を確認してください。');
};
