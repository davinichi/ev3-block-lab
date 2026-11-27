// Comments may contain project data; never allow it to close a C comment or
// introduce preprocessing lines. Authored C identifiers pass a separate validator.
export function safeComment(value){return String(value??'').replaceAll('/*','／＊').replaceAll('*/','＊／').replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,800);}
export const cComment=value=>'/* '+safeComment(value)+' */';
export const cCommentLines=lines=>'/*\n'+lines.map(s=>' * '+safeComment(s)).join('\n')+'\n */';
const sensors={encoder:'モーターの回転角度（度）',motorSpeed:'モーターの実測速度',touch:'タッチセンサー',color:'色番号',reflected:'反射光',distance:'超音波センサーの距離（cm）',gyroAngle:'ジャイロの角度（度）',gyroRate:'ジャイロの回転速度',infrared:'赤外線センサーの近さ'};
const operators={add:'＋',sub:'−',mul:'×',div:'÷',eq:'＝',neq:'≠',lt:'＜',lte:'≦',gt:'＞',gte:'≧',and:'かつ',or:'または'};
export function expressionLabel(x,depth=0){
 if(depth>5)return '式';
 const sub=v=>expressionLabel(v,depth+1);
 if(typeof x==='number')return String(x);
 if(x?.var!==undefined)return '変数「'+x.var+'」';
 if(x?.param!==undefined)return '引数「'+x.param+'」';
 if(x?.callValue)return 'マイブロック「'+x.callValue.name+'」の戻り値'+((x.callValue.output??0)+1);
 if(x?.op)return '('+sub(x.left)+' '+(operators[x.op]??x.op)+' '+sub(x.right)+')';
 if(x?.not!==undefined)return sub(x.not)+' ではない';
 if(x?.timer)return 'タイマー（秒）';
 if(x?.battery)return x.battery==='voltage'?'電池の電圧（V）':'電池の電流（A）';
 if(x?.sensor)return (sensors[x.sensor.kind]??x.sensor.kind)+'［ポート'+(['encoder','motorSpeed'].includes(x.sensor.kind)?'ABCD'[x.sensor.port-1]:x.sensor.port)+'］';
 if(x?.math)return x.math.fn+'('+sub(x.math.value)+')';
 if(x?.numeric)return x.numeric.op+'('+sub(x.numeric.a)+(x.numeric.b!==undefined?', '+sub(x.numeric.b):'')+')';
 return '数値・条件の式';
}
const ports=mask=>[...'ABCD'].filter((_,i)=>(mask??15)&(1<<i)).join('・');
const stopMode=mode=>({brake:'ブレーキ',coast:'惰性',hold:'独自の位置保持'}[mode]??'設定済みの停止方法');
export function blockDescription(b){
 const e=expressionLabel,p=b.movement?'左右に設定したモーター':ports(b.ports);
 switch(b.type){
  case 'set':return '変数「'+b.var+'」に '+e(b.value)+' を代入する。';
  case 'change':return '変数「'+b.var+'」を '+e(b.value)+' だけ増やす（共有変数は排他制御）。';
  case 'wait':return e(b.ms)+' ミリ秒待つ。待っている間も停止要求を確認する。';
  case 'waitSeconds':return e(b.seconds)+' 秒待つ。ほかのタスクも実行できる。';
  case 'if':return '条件 '+e(b.condition)+' が真なら then 側、偽なら else 側を実行する。';
  case 'repeat':return e(b.count)+' 回、波括弧 { } の中を繰り返す。';
  case 'while':return '条件 '+e(b.condition)+(b.until?' が真になるまで':' が真の間')+'繰り返す。';
  case 'forever':return 'ずっと繰り返す。戻るボタン／プログラム終了で全体を停止できる。';
  case 'motorRun':return 'モーター '+p+' を速さ '+e(b.speed)+'％で回し始め、次のブロックへ進む。';
  case 'motor':case 'motorRotations':return 'モーター '+p+' を速さ '+e(b.speed)+'％で '+e(b.type==='motor'?b.degrees:b.rotations)+(b.type==='motor'?'度':'回転')+' 回す。完了までこのタスクは次へ進まない。方式：'+({sync:'EV3RTの同期制御',feedback:'進み具合による停止タイミング補正',independent:'各モーターの目標角度を優先'}[b.mode]??'単独制御')+'。';
  case 'motorTimed':return 'モーター '+p+' を速さ '+e(b.speed)+'％で '+e(b.seconds)+' 秒動かす。設定済みの加減速と停止方法を使う。';
  case 'motorSpeedSet':return 'モーター '+p+' の速さを '+e(b.speed)+'％へ変更する。停止中なら起動しない。';
  case 'motorPower':return 'Lモーター '+p+' を未調整パワー '+e(b.speed)+'％で動かす（速さ一定の制御とは異なる）。';
  case 'stopMode':return 'モーター '+p+' の「動作後の停止方法」を '+stopMode(b.mode)+' に設定する。ここでは停止しない。';
  case 'stop':return 'モーター '+p+' を '+stopMode(b.stopMode)+' で停止する。次のブロックへ進む。';
  case 'ramp':return '以降の有限動作の加減速を '+({off:'なし',trapezoid:'台形',scurve:'S字'}[b.mode])+' に設定する。加速 '+e(b.upSeconds)+' 秒／減速 '+e(b.downSeconds)+' 秒。';
  case 'movementSetup':return 'ロボットの左右モーターを、左 '+ports(b.leftPort)+'／右 '+ports(b.rightPort)+' に設定する。';
  case 'wheel':return 'タイヤの直径を '+b.diameter+' mmに設定する。距離からモーター角度を求めるために使う。';
  case 'tread':return '左右タイヤの中心間隔（トレッド）を '+b.mm+' mmに設定する。旋回角度の計算に使う。';
  case 'drive':return '速さ '+e(b.speed)+'％で '+e(b.cm)+' cm '+(b.direction==='backward'?'後ろへ':'前へ')+'進む。距離を車輪の回転角度へ変換する。';
  case 'spin':case 'pivot':return '速さ '+e(b.speed)+'％で '+(b.direction==='right'?'右':'左')+'へ '+e(b.angle)+' 度'+(b.type==='spin'?'スピンターン（左右を逆向きに回す）':'ピボットターン（片輪を軸に回る）')+'する。';
  case 'steering':return 'ステアリング '+e(b.turn)+'、速さ '+e(b.speed)+'％で走行する。'+({run:'回し始めたら次へ進む。',angle:'外側の車輪を '+e(b.degrees)+' 度回すまで待つ。',time:e(b.seconds)+' 秒走行する。'}[b.action]);
  case 'tank':case 'tankFinite':return '左 '+e(b.leftSpeed)+'％／右 '+e(b.rightSpeed)+'％で走行する。'+(b.type==='tank'?'回し始めたら次へ進む。':b.action==='angle'?'速い側を '+e(b.degrees)+' 度回すまで待つ。':e(b.seconds)+' 秒待つ。');
  case 'call':return 'マイブロック「'+b.name+'」を関数として呼び出す。引数：'+(b.args.map(x=>e(x)).join('、')||'なし')+'。';
  case 'callOutputs':return 'マイブロック「'+b.name+'」を1回呼び、戻り値を変数 '+b.targets.map(n=>'「'+n+'」').join('、')+' に保存する。';
  case 'returnValue':case 'returnValues':return '値を返して、このマイブロックだけを終了する。呼び出し元の続きへ戻る。';
  case 'myblockReturn':return 'このマイブロックだけを終了し、呼び出し元の続きへ戻る。';
  case 'broadcast':return 'メッセージ「'+b.message+'」を送る。'+(b.wait?'対応するすべての受信処理が終わるまで待つ。':'受信処理の完了を待たず、次へ進む。');
  case 'tone':return e(b.frequency)+' Hzの音を '+e(b.ms)+' ミリ秒鳴らす。音量 '+b.volume+'％。';
  case 'led':return '本体ランプを '+(['消灯','緑','赤','オレンジ'][b.color]??b.color)+' にする。';
  case 'encoderReset':return 'モーター '+('ABCD'[b.port-1])+' の回転角度を0にする。保持中の目標位置も同じ分だけ補正する。';
  case 'gyroReset':return 'ジャイロセンサー '+b.port+' の現在の角度を、新しい0度の基準にする。';
  case 'timerReset':return '共有タイマーを0秒に戻す。';
  case 'textSet':return '文字列変数「'+b.name+'」に文字列を保存する。';
  case 'listClear':return '数値リスト「'+b.list+'」を空にする。';
  case 'listAdd':return '数値リスト「'+b.list+'」の末尾へ '+e(b.value)+' を追加する。';
  case 'listSet':return '数値リスト「'+b.list+'」の '+e(b.index)+' 番目を '+e(b.value)+' に変更する（1から数える）。';
  case 'listDelete':return '数値リスト「'+b.list+'」の '+e(b.index)+' 番目を削除する（1から数える）。';
  case 'pidReset':return 'PID制御器「'+b.name+'」の前回値と積分をリセットする。';
  case 'logStart':return 'SDカード直下のCSVログ「'+b.file+'」を新規作成し、同名ファイルを上書きする。';
  case 'logValue':return '項目「'+b.label+'」と値を、経過秒数とともにCSVへ1行記録する。';
  case 'logEnd':return '共有CSVログの記録を終了する。';
  case 'displayNumber':return '数値 '+e(b.value)+' を横 '+b.x+'、縦 '+b.y+' に小数 '+b.decimals+' 桁で表示する。';
  case 'displayClear':return 'EV3本体の画面を消す。';
  case 'displayBitmap':return '固定の文字・画像を本体画面の横 '+b.x+'、縦 '+b.y+' に描く。';
  case 'programEnd':return 'プログラム全体を終了する。すべてのタスクとモーターを停止する。';
  default:return b.type+' ブロックの処理。';
 }
}
export function procedureComment(p){return cCommentLines([
 'マイブロック「'+p.name+'」をCの関数 '+p.id+' として定義します。'+(p.name===p.id?'（ブロックと同じ名前）':'（Cで安全に使える名前へ変換）'),
 ...p.params.map((n,i)=>'引数「'+n+'」 → '+(p.cParams?.[i]??'lab_arg_'+i)+(p.cParams?.[i]===n?'（ブロックと同じ名前。この呼び出し専用の値）':'（Cで安全に使える名前へ変換。この呼び出し専用の値）')),
 p.returns?'戻り値は lab_values の value[0] から順に入ります。':'戻り値は使用しません。共通の呼び出し形式として lab_values を返します。'
]);}
export function taskComment(root,index){return cCommentLines([
 'lab_task_'+index+'：'+({start:'「スタート」につながる処理',condition:'「'+expressionLabel(root.condition)+' が成り立ったとき」の処理',changed:'「'+expressionLabel(root.condition)+' の値が変わったとき」の処理',message:'メッセージ「'+root.message+'」を受け取る処理'}[root.kind]),
 root.kind==='start'?'このタスクの命令を上から順に実行します。':'処理を重ねて実行せず、処理終了後に20ms待って再び監視します。',
 root.kind==='condition'?'偽から真になったときに実行します（開始時が真なら最初にも実行）。':root.kind==='changed'?'最初に読んだ値を基準にし、その後の変化で実行します。':root.kind==='message'?'処理中の複数通知はまとまるため、1件ずつ蓄積するキューとは異なります。':'イベント受信タスクがある場合は、このスタートが終わっても監視を続けます。'
]);}
export const CODE_GUIDE=`EBLから生成したCコードの読み方

1. app.c の「ブロックから生成したプログラム」を探してください。
   app.cにはスタート／イベントの流れとタスクの管理を置いています。
   マイブロックの関数本体はebl_myblocks.c、宣言はebl_myblocks.hにあります。
2. スタートが1個で保持も使わない場合、main_taskの中が作品の処理です。
   複数スタート・イベント・位置保持・ランプ制御がある場合、作品の処理はlab_task_0などに入ります。
   この場合のmain_taskは、初期設定・タスク起動・全体の停止を管理する係です。
3. 各ブロックの直前の日本語コメントと、画面のブロックを対応させて読んでください。
4. lab_var_0などは作品の共有変数です。ebl_rt_runtime.hの宣言のコメントに元の名前を書いています。
   forward・turn_leftなど、Cで安全に使えるマイブロック名はそのまま関数名にします。
   引数もspeed・distanceなどを保持します。日本語・予約語・補助処理やAPIと衝突する名前は変換します。
   関数はlab_proc_0、引数はlab_arg_0などに変換し、元の名前との対応をコメントに残します。
   引数が関数名と重なる場合も、関数呼び出しを隠さないよう引数名を変換します。
   lab_tmp_0などは計算の途中の値です。lab_result_0などは関数から返った値です。
5. 数値はfloatを使います。20.0fは20、0.5fは0.5を表し、末尾のfがfloat型を示します。
   通常の数値は小数表記にし、とても大きい・小さい数値では指数表記を使います。
6. lab_で始まる関数の多くは、EBLが自動生成する補助処理です。
   C言語の標準関数やEV3RTの公式APIではありません。定義はebl_rt_runtime.c、宣言はebl_rt_runtime.hにあります。
   待機・加減速・位置保持・停止確認などを行います。
   lab_waitの単位はミリ秒、HRP3のtslp_tskの単位はマイクロ秒です。
   秒のブロックでは、1000倍してミリ秒へ換算します。
   モーターの組合せはA=1、B=2、C=4、D=8の合計です。6はBとCを意味します。
7. app.cfgはEV3RTへタスクを登録する設定、app.hは関数の宣言と共通設定です。
   CRE_TSKのTA_ACTは起動時から実行、TA_NULLは後でact_tskにより起動する指定です。
8. コメントを変えても動きは変わりません。ブロックから再出力すると手編集は置き換わります。
   作品の編集データはproject.ev3labにも保存しておいてください。
9. すべての.c・.hは同じ出力一式を使い、同じフォルダーに置きます。
   #includeは、コンパイル前に別ファイルの内容をその位置へ読み込む指示です。
   .hには型・関数宣言・externによる共有変数の宣言を置き、変数の実体は1つだけ作ります。
   app.c・ebl_myblocks.c・ebl_rt_runtime.cを別々にコンパイルし、できた.oをリンクします。
   Makefile.incとapp.cfgにその設定が入っています。.cを#includeせず、他の作品のファイルと混ぜません。

if / else：条件分岐。for：繰り返し。{ }：処理のまとまり。
float：小数を扱う数値の型。return：呼び出し元へ戻る。
プログラム全体の終了と、マイブロックからのreturnは別の操作です。
排他制御：複数のタスクが共有変数などを同時に書き換えないよう、順番を守らせることです。
`;
