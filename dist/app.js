import {compile,EV3Connection,hex,programFileName,projectDirectory} from './ev3.js'; import {inspectBlocks,createBlockLibrary,mergeBlockLibrary} from './library.js'; import {sensorReading} from './sensor-monitor.js';
// 画面とBlocklyを結び付ける入口。ブロック定義 → 中間データ → ev3.jsでRBF生成 → 接続・転送の順に処理する。
// 外部ライブラリのdist/vendorは編集せず、独自ブロックと画面側の振る舞いをここに記述する。
const $=id=>document.getElementById(id);
// 自動保存はこのブラウザのlocalStorageに1作品分を保存する。クラウドやGitHubへの保存ではない。
const STORAGE='ev3-block-lab-v1';
const VERSION='0.16.1';
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
// 出力ポートの選択値はA=1、B=2、C=4、D=8のビットマスク。2個の指定は値を足したもの。
const singlePorts=[['A','1'],['B','2'],['C','4'],['D','8']];
const pairPorts=[['B + C','6'],['A + B','3'],['A + C','5'],['A + D','9'],['B + D','10'],['C + D','12']];
Blockly.defineBlocksWithJsonArray([
 {type:'ev3_start',message0:'▶ スタート',nextStatement:null,colour:'#d3a238',tooltip:'EV3本体から起動すると、ここから実行します。'},
 {type:'ev3_motor',message0:'Lモーター %1 速さ %2 ％で %3 度回す',args0:[{type:'field_dropdown',name:'PORTS',options:[singlePorts[1],singlePorts[0],singlePorts[2],singlePorts[3],...pairPorts]},{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'DEGREES',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'速度は-100〜100（0以外）。2ポートを選んだ場合の制御方式は「先生用の設定・計測」で選択します。標準は各モーターの指定角度を優先し、同期方式は検証用です。'},
 {type:'ev3_tone',message0:'音 %1 Hz を %2 ミリ秒 鳴らす 音量 %3',args0:[{type:'input_value',name:'FREQUENCY',check:'Number'},{type:'input_value',name:'MS',check:'Number'},{type:'field_number',name:'VOLUME',value:25,min:0,max:100,precision:1}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#a570b3'},
 {type:'ev3_wait',message0:'%1 ミリ秒 待つ（旧形式）',args0:[{type:'input_value',name:'MS',check:'Number'}],previousStatement:null,nextStatement:null,colour:'#d19636'},
 {type:'ev3_stop_port',message0:'モーター %1 を停止',args0:[{type:'field_dropdown',name:'PORTS',options:singlePorts}],previousStatement:null,nextStatement:null,colour:'#0090f5',tooltip:'L・M共通。選んだポートだけをブレーキ停止し、次の命令へ進みます。ほかのモーターは回転を続けます。プログラムが終了するとすべて停止します。'},
 {type:'ev3_stop',message0:'すべてのモーターを停止',previousStatement:null,nextStatement:null,colour:'#0090f5'}
]);

Blockly.defineBlocksWithJsonArray([
 ...[['l','L', [...pairPorts,...singlePorts]],['m','M',[...singlePorts,...pairPorts]]].map(([kind,label,ports])=>({type:'ev3_motor_'+kind+'_run',message0:label+'モーター %1 を速さ %2 ％で回し続ける',args0:[{type:'field_dropdown',name:'PORTS',options:ports},{type:'input_value',name:'SPEED',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'速さは−100〜100％。負の値は逆回転、0は停止。回転を始めたらすぐ次のブロックへ進み、停止の命令またはプログラム終了まで回ります。'})),
 {type:'ev3_math',message0:'%1 %2 %3',args0:[{type:'input_value',name:'A',check:'Number'},{type:'field_dropdown',name:'OP',options:[['＋','add'],['−','sub'],['×','mul'],['÷','div']]},{type:'input_value',name:'B',check:'Number'}],output:'Number',inputsInline:true,colour:'#668b6d'},
 {type:'ev3_motor_m',message0:'Mモーター %1 速さ %2 ％で %3 度回す',args0:[{type:'field_dropdown',name:'PORTS',options:[...singlePorts,...pairPorts]},{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'DEGREES',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5'},
 {type:'ev3_motor_m_time',message0:'Mモーター %1 速さ %2 ％で %3 秒動かす',args0:[{type:'field_dropdown',name:'PORTS',options:[...singlePorts,...pairPorts]},{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'SECONDS',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'時間は0より大きく60秒以下。速さを負にすると逆回転します。2ポートは同時に指定時間だけ動かします。角度の同期・停止タイミング補正は角度指定のブロックを使ってください。'},
 {type:'ev3_wait_seconds',message0:'%1 秒待つ',args0:[{type:'input_value',name:'SECONDS',check:'Number'}],previousStatement:null,nextStatement:null,colour:'#d19636',tooltip:'0〜60秒。0.5秒などの小数も使えます。'},
 {type:'ev3_tread',message0:'トレッド（タイヤ中心どうしの間隔）を %1 mm にする',args0:[{type:'field_number',name:'TREAD',value:112,min:10,max:1000,precision:.1}],previousStatement:null,nextStatement:null,colour:'#ff4ccd',tooltip:'走行・旋回の前に設定します。設定用のマイブロックにまとめることもできます。左右のタイヤ中心間の距離を測ります。'},
 ...[['right','右'],['left','左']].map(([direction,label])=>({type:'ev3_spin_'+direction,message0:'左モーター %1 右モーター %2 速さ %3 ％で '+label+'に %4 度スピンターン',args0:[{type:'field_dropdown',name:'LEFT_PORT',options:[singlePorts[1],...singlePorts.filter(p=>p[1]!=='2')]},{type:'field_dropdown',name:'RIGHT_PORT',options:[singlePorts[2],...singlePorts.filter(p=>p[1]!=='4')]},{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'ANGLE',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#ff4ccd',tooltip:'ロボットの回転角度を指定。右回転は左輪が正転・右輪が逆転、左回転は反対です。タイヤはLモーター直結を想定します。'})),
 ...[['right','右'],['left','左']].map(([direction,label])=>({type:'ev3_pivot_'+direction,message0:'左モーター %1 右モーター %2 速さ %3 ％で '+label+'に %4 度ピボットターン',args0:[{type:'field_dropdown',name:'LEFT_PORT',options:[singlePorts[1],...singlePorts.filter(p=>p[1]!=='2')]},{type:'field_dropdown',name:'RIGHT_PORT',options:[singlePorts[2],...singlePorts.filter(p=>p[1]!=='4')]},{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'ANGLE',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#ff4ccd',tooltip:'ロボットの旋回角度を指定。右旋回は右輪をブレーキ停止して左輪を正転、左旋回は左輪を停止して右輪を正転。タイヤ直径・トレッドを先に設定。モーター角度＝2×トレッド÷タイヤ直径×旋回角度。タイヤ直結のLモーターを想定します。'})),
 {type:'ev3_tank',message0:'左モーター %1 速さ %2 ％ 右モーター %3 速さ %4 ％で回し続ける',args0:[{type:'field_dropdown',name:'LEFT_PORT',options:[singlePorts[1],...singlePorts.filter(p=>p[1]!=='2')]},{type:'input_value',name:'LEFT_SPEED',check:'Number'},{type:'field_dropdown',name:'RIGHT_PORT',options:[singlePorts[2],...singlePorts.filter(p=>p[1]!=='4')]},{type:'input_value',name:'RIGHT_SPEED',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#ff4ccd',tooltip:'左右それぞれ−100〜100％の速度を直接指定。負は逆転、0はその側のブレーキ停止。L/M共通。回し始めたら次の命令へ進み、停止命令や次のモーター命令まで続けます。後ろに待つ・条件待ち・繰り返しをつなぎます。加減速や角度同期は行いません。'},
 {type:'ev3_wheel',message0:'タイヤの直径を %1 mm にする',args0:[{type:'field_number',name:'DIAMETER',value:56,min:10,max:200,precision:.1}],previousStatement:null,nextStatement:null,colour:'#ff4ccd',tooltip:'走行前に設定します。設定用マイブロックにも入れられます。タイヤをLモーターに直接取り付ける場合の直径です。'},
 ...[['forward','前に進む'],['backward','後ろに下がる']].map(([direction,label])=>({type:'ev3_drive_'+direction,message0:'Lモーター %1 速さ %2 ％で %3 cm '+label,args0:[{type:'field_dropdown',name:'PORTS',options:pairPorts},{type:'input_value',name:'SPEED',check:'Number'},{type:'input_value',name:'CM',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#ff4ccd',tooltip:'先頭にタイヤの直径を設定。速さ1〜100％、長さは正の整数。タイヤ直結・両輪の正回転が前進する取り付けを想定します。'}))
]);


Blockly.defineBlocksWithJsonArray([{type:'ev3_ramp',message0:'加減速を %1 にする 加速 %2 秒 減速 %3 秒',args0:[{type:'field_dropdown',name:'MODE',options:[['台形','trapezoid'],['S字','scurve'],['なし','off']]},{type:'input_value',name:'UP',check:'Number'},{type:'input_value',name:'DOWN',check:'Number'}],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:'後ろのL/Mモーターの角度・時間指定と走行・旋回に適用。0〜10秒。設定用マイブロックにも入れられます。回し続ける・停止ブロックは対象外。角度指定は停止位置を優先し、短い移動では指定速度に届かないことがあります。20ミリ秒ごとに速度指令を更新する試作機能です。'}]);

// New classroom palette separates one motor from a pair. Keep legacy types
// above unchanged so earlier saved projects retain their port choices.
const classroomMotorBlocks=[];
for(const [kind,label] of [['l','L'],['m','M']])for(const paired of [false,true])for(const action of ['run','angle','time']){
 const type='ev3_motor_'+kind+'_'+(paired?'pair':'single')+'_'+action;
 const ports=paired?pairPorts:kind==='l'?[singlePorts[1],singlePorts[0],singlePorts[2],singlePorts[3]]:singlePorts;
 const suffix={run:'を速さ %2 ％で回し続ける',angle:'速さ %2 ％で %3 度回す',time:'速さ %2 ％で %3 秒動かす'}[action];
 const tooltip=action==='run'?'速さ−100〜100％。負は逆転、0は停止。回し始めたら次の命令へ進みます。':action==='time'?'時間は0より大きく60秒以下。0.5秒なども使えます。速さは−100〜100％で0以外。':'速さは−100〜100％で0以外。指定角度まで回してから次の命令へ進みます。';
 classroomMotorBlocks.push({type,message0:label+'モーター'+(paired?'2個':'1個')+' %1 '+suffix,args0:[{type:'field_dropdown',name:'PORTS',options:ports},{type:'input_value',name:'SPEED',check:'Number'},...(action==='run'?[]:[{type:'input_value',name:action==='angle'?'DEGREES':'SECONDS',check:'Number'}])],previousStatement:null,nextStatement:null,inputsInline:true,colour:'#0090f5',tooltip:tooltip+(paired?(action==='angle'?' 同期・停止タイミング補正の方式は「先生用の設定・計測」で選べます。':' 2個を同時に同じ速さの指定で始動します。角度同期の補正はしません。'):'')});
}
Blockly.defineBlocksWithJsonArray(classroomMotorBlocks);
// L/Mそれぞれを単独・2個に分け、連続回転／角度／時間を同じ順番で表示する。
function classroomMotorToolbox(){
 const items=[{kind:'label',text:'加速・減速（L・M共通）'},{kind:'block',type:'ev3_ramp',inputs:{UP:shadow(.5),DOWN:shadow(.5)}}];
 for(const [kind,label] of [['l','L'],['m','M']])for(const paired of [false,true]){
  items.push({kind:'label',text:label+'モーター '+(paired?'2個（同期・同時）':'1個')});
  for(const action of ['run','angle','time'])items.push({kind:'block',type:'ev3_motor_'+kind+'_'+(paired?'pair':'single')+'_'+action,inputs:{SPEED:shadow(20),...(action==='angle'?{DEGREES:shadow(90)}:action==='time'?{SECONDS:shadow(1)}:{})}});
 }
 return [...items,{kind:'label',text:'モーターを停止（L・M共通）'},{kind:'block',type:'ev3_stop_port'},{kind:'block',type:'ev3_stop'}];
}

// 入力センサのポート番号は1〜4。モーター出力のビットマスクとは別の番号体系。
const sensorPorts=[['1','1'],['2','2'],['3','3'],['4','4']];
const brickButtons=[['中央','2'],['上','1'],['下','3'],['左','5'],['右','4'],['いずれか','7']];
const colorNames=[['赤','5'],['黒','1'],['青','2'],['緑','3'],['黄','4'],['白','6'],['茶','7'],['色なし','0']];
const sensorPort=()=>({type:'field_dropdown',name:'PORT',options:sensorPorts});
const comparison=()=>({type:'field_dropdown',name:'OP',options:[['＜','lt'],['＝','eq'],['＞','gt'],['≦','lte'],['≧','gte'],['≠','neq']]});
Blockly.defineBlocksWithJsonArray([
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

const num=(n)=>({kind:'block',type:'math_number',fields:{NUM:n}});
const shadow=(n)=>({shadow:{type:'math_number',fields:{NUM:n}}});
// 左側カテゴリの公開一覧。新規ブロック追加時は、定義・chain/expression・library.jsの許可一覧も確認する。
const toolbox={kind:'categoryToolbox',contents:[
 {kind:'category',name:'スタート',colour:'#d3a238',contents:[{kind:'block',type:'ev3_start'}]},
 {kind:'category',name:'モーター',colour:'#0090f5',contents:classroomMotorToolbox()},
 {kind:'category',name:'動き',colour:'#ff4ccd',contents:[{kind:'block',type:'ev3_wheel'},{kind:'block',type:'ev3_tread'},{kind:'block',type:'ev3_tank',inputs:{LEFT_SPEED:shadow(20),RIGHT_SPEED:shadow(20)}},{kind:'block',type:'ev3_spin_right',inputs:{SPEED:shadow(20),ANGLE:shadow(90)}},{kind:'block',type:'ev3_spin_left',inputs:{SPEED:shadow(20),ANGLE:shadow(90)}},{kind:'block',type:'ev3_pivot_right',inputs:{SPEED:shadow(20),ANGLE:shadow(90)}},{kind:'block',type:'ev3_pivot_left',inputs:{SPEED:shadow(20),ANGLE:shadow(90)}},{kind:'block',type:'ev3_drive_forward',inputs:{SPEED:shadow(20),CM:shadow(20)}},{kind:'block',type:'ev3_drive_backward',inputs:{SPEED:shadow(20),CM:shadow(20)}}]},
 {kind:'category',name:'センサー',colour:'#34ccf1',contents:[{kind:'label',text:'EV3本体のボタン'},{kind:'block',type:'ev3_brick_button'},{kind:'block',type:'ev3_brick_button_value'},{kind:'label',text:'タイマー'},{kind:'block',type:'ev3_timer'},{kind:'block',type:'ev3_timer_reset'},{kind:'label',text:'モーターのエンコーダ'},{kind:'block',type:'ev3_encoder'},{kind:'block',type:'ev3_encoder_reset'},{kind:'label',text:'EV3 タッチセンサ'},{kind:'block',type:'ev3_touch'},{kind:'block',type:'ev3_touch_value'},{kind:'label',text:'EV3 赤外線センサ'},{kind:'block',type:'ev3_ir_proximity'},{kind:'block',type:'ev3_ir_compare',inputs:{VALUE:shadow(20)}},{kind:'block',type:'ev3_ir_button'},{kind:'block',type:'ev3_ir_remote'},{kind:'block',type:'ev3_ir_beacon_detected'},{kind:'block',type:'ev3_ir_beacon_heading'},{kind:'block',type:'ev3_ir_beacon_distance'},{kind:'label',text:'EV3 カラーセンサ'},{kind:'block',type:'ev3_color_is'},{kind:'block',type:'ev3_color_value'},{kind:'block',type:'ev3_reflected_compare',inputs:{VALUE:shadow(50)}},{kind:'block',type:'ev3_reflected'},{kind:'label',text:'EV3 超音波センサ'},{kind:'block',type:'ev3_distance_compare',inputs:{VALUE:shadow(15)}},{kind:'block',type:'ev3_distance'}]},
 {kind:'category',name:'音',colour:'#a570b3',contents:[{kind:'block',type:'ev3_tone',inputs:{FREQUENCY:shadow(440),MS:shadow(200)}}]},
 {kind:'category',name:'制御',colour:controlColour,contents:[{kind:'block',type:'ev3_wait_seconds',inputs:{SECONDS:shadow(1)}},{kind:'block',type:'controls_if'},{kind:'block',type:'controls_if',extraState:{hasElse:true}},{kind:'block',type:'ev3_forever'},{kind:'block',type:'controls_repeat_ext',inputs:{TIMES:shadow(10)}},{kind:'block',type:'controls_whileUntil',fields:{MODE:'UNTIL'}},{kind:'block',type:'controls_whileUntil',fields:{MODE:'WHILE'}},{kind:'block',type:'ev3_wait_until'},{kind:'block',type:'ev3_program_end'},{kind:'block',type:'ev3_myblock_return'}]},
 {kind:'category',name:'演算',colour:operatorColour,contents:[num(0),...['add','sub','mul','div'].map(op=>({kind:'block',type:'ev3_op_'+op,inputs:{A:shadow(1),B:shadow(1)}})),{kind:'block',type:'ev3_math_function',inputs:{VALUE:shadow(1)}},...['lt','eq','gt','lte','gte','neq'].map(op=>({kind:'block',type:'ev3_op_'+op,inputs:{A:shadow(0),B:shadow(100)}})),...['and','or'].map(op=>({kind:'block',type:'ev3_op_'+op})),{kind:'block',type:'logic_negate'},{kind:'block',type:'logic_boolean'}]},
 {kind:'category',name:'変数',colour:'#c58245',custom:'VARIABLE'},
 {kind:'category',name:'マイブロック',colour:'#aa597e',custom:'PROCEDURE'},
 {kind:'category',name:'引数',colour:'#668b6d',custom:'ARGUMENTS'}
]};

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
const theme=Blockly.Theme.defineTheme('ev3lab',{base:Blockly.Themes.Classic,fontStyle:{family:'"Yu Gothic UI", Meiryo, sans-serif',size:12},blockStyles:{procedure_blocks:{colourPrimary:'#aa597e'},math_blocks:{colourPrimary:'#668b6d'},variable_blocks:{colourPrimary:'#c58245'},loop_blocks:{colourPrimary:'#d19636'}},componentStyles:{workspaceBackgroundColour:'#fbfcfd',toolboxBackgroundColour:'#f4f7f8',flyoutBackgroundColour:'#eef3f5',flyoutOpacity:1,scrollbarColour:'#b9c9ce',insertionMarkerColour:'#126c67',insertionMarkerOpacity:.3}});
const workspace=Blockly.inject('blocklyDiv',{toolbox,theme,renderer:'zelos',media:'vendor/media/',trashcan:true,scrollbars:true,grid:{spacing:24,length:2,colour:'#e5ebee',snap:false},zoom:{controls:true,wheel:true,startScale:.85,minScale:.35,maxScale:1.5,scaleSpeed:1.1},move:{scrollbars:true,drag:true,wheel:true},sounds:false});
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
  $('readSensors').disabled=busy||!connection.connected;$('autoSensors').disabled=!connection.connected;
  $('connect').disabled=busy||!isSecureContext||!($('connectionMethod').value==='usb'?navigator.hid:navigator.serial);$('disconnect').disabled=busy;$('downloadRbf').disabled=busy || !lastBuild || !validName || !validFolder;
  $('recordCounts').disabled=busy || !connection.connected;
  $('readCounts').disabled=busy || !connection.connected || !baselineCounts;
  $('readTiming').disabled=busy || !connection.connected || !lastBuild?.diagnosticPath;
}
// 丸い数値ブロック・条件ブロックを中間データへ変換する。センサやボタンの実測はここでは行わない。
function expression(x){
 if(!x)throw Error('数値・条件の空欄にブロックを入れてください。');
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
 if(x.type==='ev3_timer')return {timer:true};
 if(x.type==='ev3_encoder')return {sensor:{kind:'encoder',port:Number(x.getFieldValue('PORT'))}};
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
      case 'ev3_tank':out.push({type:'tank',leftPort:Number(b.getFieldValue('LEFT_PORT')),rightPort:Number(b.getFieldValue('RIGHT_PORT')),leftSpeed:value(b,'LEFT_SPEED'),rightSpeed:value(b,'RIGHT_SPEED')});break;
      case 'ev3_pivot_right':case 'ev3_pivot_left':out.push({type:'pivot',leftPort:Number(b.getFieldValue('LEFT_PORT')),rightPort:Number(b.getFieldValue('RIGHT_PORT')),speed:value(b,'SPEED'),angle:value(b,'ANGLE'),direction:b.type==='ev3_pivot_right'?'right':'left'});break;
      case 'ev3_spin_right':case 'ev3_spin_left':out.push({type:'spin',leftPort:Number(b.getFieldValue('LEFT_PORT')),rightPort:Number(b.getFieldValue('RIGHT_PORT')),speed:value(b,'SPEED'),angle:value(b,'ANGLE'),direction:b.type==='ev3_spin_right'?'right':'left'});break;
      case 'ev3_wheel':out.push({type:'wheel',diameter:Number(b.getFieldValue('DIAMETER'))});break;
      case 'ev3_drive_forward':case 'ev3_drive_backward':out.push({type:'drive',ports:Number(b.getFieldValue('PORTS')),speed:value(b,'SPEED'),cm:value(b,'CM'),direction:b.type==='ev3_drive_forward'?'forward':'backward',mode:$('pairMode').value});break;
      case 'ev3_tone':out.push({type:'tone',frequency:value(b,'FREQUENCY'),ms:value(b,'MS'),volume:Number(b.getFieldValue('VOLUME'))});break;
      case 'ev3_wait':out.push({type:'wait',ms:value(b,'MS')});break;
      case 'ev3_timer_reset':out.push({type:'timerReset'});break;
      case 'ev3_encoder_reset':out.push({type:'encoderReset',port:Number(b.getFieldValue('PORT'))});break;
      case 'ev3_stop_port':out.push({type:'stop',ports:Number(b.getFieldValue('PORTS'))});break;
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
// スタートから到達する命令と、そこから呼ばれるマイブロックだけを集める。未接続の試作ブロックは転送対象に含めない。
function program(){
  const roots=workspace.getTopBlocks(true).filter(b=>b.isEnabled());
  const starts=roots.filter(b=>b.type==='ev3_start');
  if(starts.length!==1)throw Error('「スタート」ブロックは1個だけ置いてください。');
  const main=chain(starts[0].getNextBlock()),used=new Map();
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
  gather(main);
  return {main,procedures:[...used.values()]};
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
    $('buildDetails').textContent=`${lastBuild.data.length} バイト / マイブロック ${lastBuild.objects.length-1} 個 / EV3標準形式${lastBuild.usesRamps?' / 加減速（試作）':''}${lastBuild.usesFloat?' / 小数計算対応':''}${lastBuild.usesSensors?' / センサは本体実行時に読み取り':''}`;
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
  const backup=Blockly.serialization.workspaces.save(workspace);
  loading=true;
  try{Blockly.serialization.workspaces.load(data.workspace,workspace);}
  catch(e){Blockly.serialization.workspaces.load(backup,workspace);throw e;}
  finally{loading=false;}
  $('ev3ProjectName').value=typeof data.ev3ProjectName==='string'?data.ev3ProjectName:'EV3Lab';
  $('programName').value=typeof data.programName==='string'?data.programName:'MyProgram';
  $('pairMode').value=['sync','feedback'].includes(data.pairMode)?data.pairMode:'independent';
  workspace.clearUndo();check();
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
 loading=true;try{Blockly.serialization.workspaces.load({blocks:{languageVersion:0,blocks:[first]}},workspace);$('programName').value='SpinTurn';workspace.clearUndo();}finally{loading=false;}check();saveLocal();dirty=false;feedback('直径56mm・トレッド112mmの例です。実物の寸法と左右のポートに合わせて変更してください。');
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
 loading=true;try{workspace.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml),workspace);$('programName').value='ForwardBackward';workspace.clearUndo();}finally{loading=false;}check();saveLocal();dirty=false;feedback('タイヤ直径56mm・B+C・前後20cmのサンプルです。実物の直径を確認してください。');
};
$('soundSample').onclick=()=>replaceSample('sound');$('motorSample').onclick=()=>replaceSample('motor');
$('undo').onclick=()=>workspace.undo(false);$('redo').onclick=()=>workspace.undo(true);
$('help').onclick=()=>$('helpDialog').showModal();
$('newProject').onclick=()=>{
 if(workspace.getAllBlocks(false).length && !confirm('新しい作品を作ります。現在の作品が必要な場合は、先に「保存」してください。'))return;
 loading=true;
 try{Blockly.serialization.workspaces.load({blocks:{languageVersion:0,blocks:[{type:'ev3_start',x:30,y:35}]}},workspace);$('ev3ProjectName').value='EV3Lab';$('programName').value='MyProgram';workspace.clearUndo();}
 finally{loading=false;}
 savedPath='';dirty=false;check();saveLocal();feedback('新しい作品を作りました。マイブロックの読み込みもできます。');
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
    restore(data);saveLocal();dirty=false;feedback('プロジェクトを読み込みました。');
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
function clearSensorValues(){for(let p=1;p<=4;p++){$('sensorValue'+p).textContent='—';$('sensorLabel'+p).textContent='未取得';}for(const p of 'ABCD')$('motorValue'+p).textContent='—';$('sensorMonitorStatus').textContent='接続して「値を読む」を押してください。';}
// 監視も転送と同じ通信経路を使うためbusyで排他する。読み取り完了後に次回を予約し、通信を重ねない。
// この表示更新は接続中だけの機能。転送したプログラム内のセンサ判定はEV3本体で独立して動く。
async function refreshSensorValues(){
 if(!connection.connected||busy){if($('autoSensors').checked)monitorTimer=setTimeout(refreshSensorValues,500);return;}
 busy=true;updateButtons();$('sensorMonitorStatus').textContent='読み取っています…';
 try{const snapshot=await connection.readSensorSnapshot();for(const input of snapshot.inputs){const reading=sensorReading(input);$('sensorLabel'+input.port).textContent=reading.label;$('sensorValue'+input.port).textContent=reading.text;}for(const motor of snapshot.motors)$('motorValue'+motor.port).textContent=motor.value===null?'—':motor.value+'°';$('sensorMonitorStatus').textContent='更新 '+new Date().toLocaleTimeString();}
 catch(e){stopSensorMonitor();clearSensorValues();$('sensorMonitorStatus').textContent='読み取れませんでした。'+e.message;}
 finally{busy=false;updateButtons();if($('autoSensors').checked&&connection.connected)monitorTimer=setTimeout(refreshSensorValues,500);}
}
$('readSensors').onclick=()=>refreshSensorValues();
$('autoSensors').onchange=()=>{clearTimeout(monitorTimer);monitorTimer=null;if($('autoSensors').checked)void refreshSensorValues();};
