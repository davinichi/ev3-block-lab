// 英語の表示カタログ。命令の識別子や利用者のデータは翻訳しない。
export const catalog={blocks:{},tips:{},text:{}};
const B=catalog.blocks,T=catalog.text;
const messages={
ev3_movement_stop:'stop moving',ev3_return_value:'return %1 and exit this My Block',ev3_movement_setup:'set movement motors: left %1 right %2',ev3_start:'▶ start',
ev3_motor:'L motor %1 speed %2 % for %3 degrees',ev3_tone:'play tone %1 Hz for %2 ms volume %3',ev3_wait:'wait %1 ms (legacy)',ev3_stop_port:'stop motor %1 using %2',ev3_stop:'stop all motors',
ev3_motor_l_run:'run L motor %1 at %2 %',ev3_motor_m_run:'run M motor %1 at %2 %',ev3_motor_m:'M motor %1 speed %2 % for %3 degrees',ev3_motor_m_time:'M motor %1 speed %2 % for %3 seconds',
ev3_wait_seconds:'wait %1 seconds',ev3_tread:'set track width (wheel center to center) to %1 mm',ev3_tank:'run left at %1 % right at %2 %',ev3_wheel:'set wheel diameter to %1 mm',
ev3_drive_forward:'move forward %2 cm at %1 %',ev3_drive_backward:'move backward %2 cm at %1 %',ev3_ramp:'set ramp profile %1 acceleration %2 s deceleration %3 s',
ev3_motor_speed_set:'set motor %1 speed to %2 %',ev3_motor_power:'run motor %1 at power %2 %',ev3_motor_stop:'stop motor %1 using %2',ev3_motor_stop_mode:'set motor %1 end behavior to %2',ev3_motor_speed:'motor %1 actual speed (%)',
ev3_tank_angle:'left speed %1 % right speed %2 % for %3 degrees of the faster motor',ev3_tank_time:'left speed %1 % right speed %2 % for %3 seconds',
ev3_gyro_angle:'gyro sensor %1 angle (degrees)',ev3_gyro_rate:'gyro sensor %1 angular speed (degrees/s)',ev3_gyro_compare:'gyro sensor %1 %2 %3 %4',ev3_gyro_reset:'reset gyro sensor %1 angle to 0',
ev3_battery_voltage:'EV3 battery voltage (V)',ev3_battery_current:'EV3 battery current (A)',ev3_pid_reset:'reset PID %1',
ev3_color_is:'color sensor %1 detects %2',ev3_color_value:'color sensor %1 color number',ev3_reflected:'color sensor %1 reflected light (%)',ev3_reflected_compare:'color sensor %1 reflected light %2 %3 %',
ev3_distance:'ultrasonic sensor %1 distance (cm)',ev3_distance_compare:'ultrasonic sensor %1 distance %2 %3 cm',ev3_forever:'forever %1',ev3_wait_until:'wait until %1',
ev3_brick_button:'brick %1 button %2',ev3_brick_button_value:'brick %1 button value (0/1)',ev3_timer:'timer (seconds)',ev3_timer_reset:'reset timer',ev3_encoder_reset:'reset motor %1 angle to 0',ev3_encoder:'motor %1 rotation angle (degrees)',
ev3_touch:'touch sensor %1 %2',ev3_touch_value:'touch sensor %1 value (0/1)',ev3_ir_proximity:'infrared sensor %1 proximity (0–100)',ev3_ir_compare:'infrared sensor %1 proximity %2 %3',
ev3_ir_remote:'infrared sensor %1 channel %2 button code',ev3_ir_button:'infrared sensor %1 channel %2 button %3',ev3_ir_beacon_detected:'infrared sensor %1 channel %2 beacon detected',ev3_ir_beacon_heading:'infrared sensor %1 channel %2 beacon heading (−25–25)',ev3_ir_beacon_distance:'infrared sensor %1 channel %2 beacon proximity (0–100)',
ev3_program_end:'end program',ev3_myblock_return:'exit this My Block',ev3_op_and:'%1 and %2',ev3_op_or:'%1 or %2',ev3_math_function:'%2 of %1',ev3_led:'set brick light %1 %2',ev3_led_off:'turn brick light off',
ev3_steering_run:'run at speed %2 % steering %1',ev3_steering_angle:'speed %2 % steering %1 for %3 degrees of the outer motor',ev3_steering_time:'speed %2 % steering %1 for %3 seconds',
ev3_log_start:'start CSV log %1',ev3_log_value:'record item %1 value %2 to CSV',ev3_log_end:'close CSV log',
ev3_data_mod:'%1 mod %2',ev3_data_random:'random integer from %1 to %2',ev3_data_min:'minimum of %1 and %2',ev3_data_max:'maximum of %1 and %2',ev3_data_round:'round %1',ev3_data_clamp:'clamp %1 between %2 and %3',
ev3_text:'text %1',ev3_text_join:'join %1 and %2',ev3_text_length:'length of %1',ev3_text_letter:'letter %2 of %1',ev3_text_contains:'%1 contains %2',ev3_text_equal:'%1 equals %2',ev3_text_number:'number %1 as text',ev3_text_to_number:'text %1 as number',ev3_text_set:'set text variable %1 to %2',ev3_text_get:'%1',
ev3_list_add:'add %2 to list %1',ev3_list_set:'set item %2 of list %1 to %3',ev3_list_delete:'delete item %2 of list %1',ev3_list_clear:'clear list %1',ev3_list_item:'item %2 of list %1',ev3_list_length:'length of list %1',ev3_list_contains:'list %1 contains %2',ev3_list_stat:'%2 of list %1',
ev3_when_condition:'when %1 becomes true',ev3_when_changed:'when %1 changes',ev3_when_message:'when I receive %1',ev3_message_send:'broadcast %1',ev3_message_wait:'broadcast %1 and wait',
ev3_display_clear:'clear brick screen',ev3_display_text:'display text %1 x %2 y %3 size %4',ev3_display_image:'display image %1 x %2 y %3 size %4',ev3_display_number:'display number %1 x %2 y %3 size %4 decimal places %5'
};
for(const [type,text]of Object.entries(messages))B[type]=[text];
B.ev3_forever=['forever','%1'];
B.ev3_pid=['PID %1 target %2 measured %3','output with kp %1 ki %2 kd %3'];
for(const kind of ['l','m'])for(const group of ['single','pair'])for(const action of ['run','angle','rotation','time'])B['ev3_motor_'+kind+'_'+group+'_'+action]=[(group==='pair'?'two ':'')+kind.toUpperCase()+' motor'+(group==='pair'?'s':'')+' %1 '+({run:'run at speed %2 %',angle:'speed %2 % for %3 degrees',rotation:'speed %2 % for %3 rotations',time:'speed %2 % for %3 seconds'})[action]];
for(const direction of ['left','right']){B['ev3_spin_'+direction]=['spin '+direction+' %2 degrees at %1 %'];B['ev3_pivot_'+direction]=['pivot '+direction+' %2 degrees at %1 %'];}
// 数値・比較の記号は日英共通。その他の独自ブロックは作成時に組み立てる。
for(const type of Object.keys(B)){
 let tip='';
 if(type.includes('motor')||type==='ev3_tank'||type.includes('steering')||type.includes('tank_'))tip='Speeds are −100 to 100%. A negative speed reverses rotation. Finite moves require a nonzero speed. Continuous commands return immediately; use stop or a wait/condition after starting.';
 if(type.includes('drive_'))tip='Run the shared movement motors for the specified distance. Set movement motors and wheel diameter first. Negative speed reverses the named direction; zero is not allowed. Wheels are assumed to be directly driven by L motors.';
 if(type.includes('spin_')||type.includes('pivot_'))tip='Set movement motors, wheel diameter and track width first. The angle describes the robot turn. Negative speed reverses rotation. A pivot keeps one wheel stopped; a spin turns the wheels in opposite directions.';
 if(type.includes('gyro_'))tip='Read the EV3 gyro sensor. Reset records the current angle as this program’s zero; it does not recalibrate the sensor. Keep the robot still when resetting.';
 if(type.includes('ir_'))tip='Read the EV3 infrared sensor. Select input port and, for remote/beacon modes, channel 1–4. Proximity is relative, not centimeters. Switching modes may take time.';
 if(type.startsWith('ev3_display_'))tip='Draw on the EV3 brick’s 178×128 screen. Coordinates start at the upper-left corner (0,0). Display commands do not wait; add a wait or loop to keep a result visible or update it.';
 if(type.startsWith('ev3_list_'))tip='Named numeric list. Lists are shared within the program; item numbers start at 1. Out-of-range item access stops with an error. Lists do not persist across runs.';
 if(type.startsWith('ev3_text'))tip='Text values use named text storage, separate from numeric variables. User text is preserved when changing the editor language.';
 if(type.startsWith('ev3_data_')||type.startsWith('ev3_math'))tip='Calculate a numeric result. Use this round block in a numeric input. Values must be finite; invalid arithmetic stops the program.';
 if(tip)catalog.tips[type]=tip;
}
Object.assign(catalog.tips,{
ev3_movement_stop:'Brake only the two currently configured movement motors, then continue to the next command. Other motors keep running. Movement motor setup is required; wheel dimensions are not.',
ev3_movement_setup:'Set the shared left/right motor ports when this block runs. Ports must differ. Changing the pair first stops the old pair. Repeating the same setting does not stop the motors. Each program run starts unconfigured.',
ev3_start:'Execution starts here. Multiple start stacks run concurrently. Sensor and message events keep the program alive until it is ended.',
ev3_ramp:'Apply trapezoidal or smoothstep S-curve acceleration/deceleration to subsequent finite motor/drive/turn moves. Times are 0–10 seconds. Continuous, steering and tank commands are not ramped.',
ev3_tone:'Play a tone at 250–10000 Hz for 1–30000 milliseconds; volume 0–100. Waits for the tone to finish.',ev3_wait_seconds:'Wait 0–60 seconds. Fractional seconds, such as 0.5, are allowed.',
ev3_battery_voltage:'Battery pack voltage measured by the brick, in volts. This is not a battery percentage.',ev3_battery_current:'Total current measured by the brick, in amperes. This is not an individual motor’s current.',
ev3_pid:'PID output from target minus measured value, using elapsed seconds. States with the same name are shared. First call uses P only; repeated calls in the same millisecond reuse the result. Clamp the output to your required range.',ev3_pid_reset:'Clear the integral, previous error and timing for this named PID state.',
ev3_log_start:'Create or overwrite a CSV log in the current EV3 project folder. Open only one log at a time.',ev3_log_value:'Append a labeled numeric value and timestamp to the active CSV log.',ev3_log_end:'Close the active CSV file before exporting it.',
ev3_program_end:'End the entire program and stop all motors, including parallel stacks and event handlers.',ev3_myblock_return:'Return from a My Block without a result. For a numeric My Block use a return-value command instead.',
ev3_wait_until:'Wait until the condition becomes true. Motors started by a continuous command can keep running while waiting.',ev3_forever:'Repeat these commands until the program is ended.',
ev3_color_is:'Compare the EV3 color sensor’s detected color with a selected color.',ev3_color_value:'Return the detected EV3 color number: 0 none, 1 black, 2 blue, 3 green, 4 yellow, 5 red, 6 white, 7 brown.',ev3_reflected:'Reflected light intensity, 0–100%. Keep sensor height consistent.',ev3_distance:'EV3 ultrasonic distance in centimeters. The program uses integer centimeters.',
ev3_when_condition:'Start the handler on a false-to-true transition. It does not start another copy while already running.',ev3_when_changed:'Start the handler when the numeric value changes. One instance of this handler runs at a time.',ev3_when_message:'Run this handler when the selected message is broadcast.',ev3_message_send:'Notify matching message handlers and continue immediately.',ev3_message_wait:'Notify matching handlers and wait for the participating handlers to finish.'
});
// 画面・メニュー・選択肢に使う短い語句。
const words=`
上\tup
下\tdown
中\tmedium
値\tvalue
右\tright
左\tleft
度\tdegrees
白\twhite
緑\tgreen
茶\tbrown
赤\tred
青\tblue
黄\tyellow
黒\tblack
音\tSound
S字\tS-curve
かつ\tand
なし\tnone
なら\tthen
ばつ\tcross
不明\tunknown
中央\tcenter
作る\tCreate
保持\thold
停止\tstop
切断\tDisconnect
制御\tControl
削除\tRemove
前進\tforward
動き\tMovement
受信\tReceive
台形\tTrapezoid
右上\ttop right
右下\tbottom right
名前\tname
変数\tVariables
定義\tdefine
左上\ttop left
左下\tbottom left
平均\taverage
引数\tParameters
惰性\tcoast
押下\tpressed
接続\tConnection
本体\tbrick
検出\tdetected
消去\tClear
測定\tmeasurement
演算\tOperators
点滅\tblink
点灯\tsteady
画面\tDisplay
編集\tEdit
補足\tNote
複製\tDuplicate
角度\tangle
記録\tRecording
起動\tStart
距離\tdistance
近さ\tproximity
送信\tSend
速さ\tspeed
速度\tspeed
選ぶ\tChoose
開く\tOpen
音量\tvolume
えがお\tsmile
すべて\tall
ずっと\tforever
その他\tMore
または\tor
エラー\tError
カラー\tColor
タッチ\tTouch
データ\tData
ハート\theart
メイン\tmain
ランプ\tLight
上矢印\tup arrow
下矢印\tdown arrow
保存先\tdestination
反射光\treflected light
右矢印\tright arrow
周囲光\tambient light
周波数\tfrequency
左矢印\tleft arrow
平方根\tsquare root
度／秒\tdegrees/s
戻り値\tResult
最大値\tmaximum
最小値\tminimum
未取得\tnot read
未完了\tincomplete
未接続\tNot connected
絶対値\tabs
色なし\tno color
色番号\tcolor number
赤で音\tTone on red
赤外線\tInfrared
超音波\tUltrasonic
返す値\treturn
音だけ\tSound only
↓ 保存\t↓ Save
いずれか\tany
イベント\tEvents
オレンジ\torange
サンプル\tSample
ジャイロ\tGyro
スタート\tStart
センサー\tSensors
タイマー\tTimer
チェック\tcheck
ビーコン\tbeacon
ブレーキ\tbrake
モーター\tMotors
値を読む\tRead values
入力 1\tInput 1
入力 2\tInput 2
入力 3\tInput 3
入力 4\tInput 4
切り上げ\tceiling
切り下げ\tfloor
前に進む\tmove forward
回転角度\trotation angle
回転速度\tangular speed
変数の値\tvariable value
待ち時間\twait time
押された\tis pressed
押下回数\tpress count
接続する\tConnect
接続方法\tConnection method
照合完了\tVerification complete
確認する\tCheck
自動更新\tAuto refresh
角度読取\tRead angle
計測完了\tMeasurement complete
計測結果\tMeasurement result
計測開始\tStart measurement
計算結果\tCalculated result
離された\tis released
音の長さ\ttone duration
48ドット\t48 pixels
96ドット\t96 pixels
HTML版\tHTML manual
Lモーター\tL motor
Mモーター\tM motor
PID出力\tPID output
PID制御\tPID control
USB接続\tUSB connection
かなしい顔\tsad face
でなければ\telse
でなければ、もし\telse if
キャンセル\tCancel
プログラム\tProgram
メッセージ\tmessage
ライセンス\tLicenses
ランプの色\tlight color
ログを保存\tSave log
全体を見る\tShow all
前進・後退\tForward / backward
右上＋右下\ttop right + bottom right
回し続ける\trun continuously
変数と分岐\tVariables and conditions
変数の名前\tVariable name
変更を保存\tSave changes
左上＋右上\ttop left + top right
左上＋右下\ttop left + bottom right
左上＋左下\ttop left + bottom left
左下＋右上\tbottom left + top right
左下＋右下\tbottom left + bottom right
引数の名前\tParameter name
接続が無効\tConnection invalid
接続・転送\tConnect / transfer
数値を返す\tReturn numbers
角度（度）\tangle (degrees)
距離で停止\tStop at distance
閉じる ×\tClose ×
LモーターB\tL motor B
⌁ 通信ログ\t⌁ Communication log
▶ スタート\t▶ start
の間繰り返す\trepeat while
まで繰り返す\trepeat until
ゆっくり点滅\tslow blink
ステアリング\tSteering
スピンターン\tSpin turn
タッチセンサ\tTouch sensor
ファイル生成\tBuild file
プログラム名\tProgram name
プロジェクト名\tProject name
マイブロック\tMy Blocks
モーター A\tMotor A
モーター B\tMotor B
モーター C\tMotor C
モーター D\tMotor D
リストの番号\tlist index
不明なエラー\tUnknown error
停止時刻記録\tStop timing record
変数をつくる\tCreate variable
完了音エラー\tCompletion sound error
後ろに下がる\tmove backward
戻り値の名前\tResult names
押されている\tis pressed
画面の使い方\tDisplay guide
繰り返し回数\trepeat count
読み取り待ち\twaiting for data
速度・パワー\tspeed / power
離されている\tis released
EV3を再起動\tRestart EV3
■ 実行を停止\t■ Stop program
ずっと繰り返す\tforever
びっくりした顔\tsurprised face
サンプルを開く\tOpen sample
ジャイロセンサ\tGyro sensor
タイマー（秒）\ttimer (seconds)
合計\tsum
速い点滅\tfast blink
押されていない\tnot pressed
なし（命令をまとめる）\tNone (commands only)
＋ 引数を追加\t+ Add parameter
＋ 戻り値を追加\t+ Add result
マイブロックを作る\tCreate My Block
マイブロックの名前\tMy Block name
返す値 \treturn 
を返してこのマイブロックを終了する\treturn these values and exit this My Block
マイブロックを呼び出します。\tCall this My Block.
同じ引数名を定義したマイブロックの中で使えます。値は呼び出しごとに別々です。\tUse this parameter inside a My Block that defines the same name. Values are independent for each call.
呼び出すたびに定義内の命令を実行し、選んだ戻り値を返します。別の戻り値の呼び出しでも再実行します。\tRun the My Block on every call and return the selected result. Selecting another result calls the My Block again.
`;
for(const row of words.trim().split('\n')){const at=row.indexOf('\t');if(at>=0)T[row.slice(0,at)]=row.slice(at+1);}
// 画面の文は用語の置換より優先して、文全体で翻訳する。
Object.assign(T,{
'保存先の名前を確認してください。':'Check the destination names.',
'動きに使うモーターを設定してください。設定ブロックを動きより前につなぎ、左右の配線を再確認してください。':'Set movement motors before movement commands, and check left/right wiring.',
'「切断」を押す':'Press Disconnect',
'試作版：L/Mモーターの連続回転・角度・L/Mモーター時間・タイヤ直径とcm走行・左右スピン・ピボットターン・左右独立速度・音・秒で待つ・繰り返し・引数付きマイブロックに対応。変数・四則演算・条件分岐・回数／条件付き繰り返しにも対応。EV3カラー・超音波・ジャイロ・タッチ・赤外線（近さ／リモコン／ビーコン）、モーターのエンコーダ読取・リセットに対応。':'Prototype supports L/M motors, distance moves, turns, separate speeds, sound, waits, loops, My Blocks, variables and operators. Sensors include color, ultrasonic, gyro, touch, infrared and motor encoders.',
'やり直す':'Redo','元に戻す':'Undo','閉じる':'Close','を選択':'Select','例：回数':'e.g. count','例：前に進む':'e.g. move forward','例：距離':'e.g. distance','ブロック編集':'Block editor',
'ピボットターン':'Pivot turn','停止方法を比較':'Compare stop modes','停止時刻の記録':'Stop timing record','共通設定で前進':'Forward with shared setup','実機テスト待ち':'Hardware testing pending','本体画面の表示':'Brick display','画面表示の説明':'Display guide','転送の進行状況':'Transfer progress','2モーターの制御':'Two-motor control','EV3に保存する':'Save to EV3','HTML版を読む':'Read HTML manual','▶ 転送して実行':'▶ Transfer and run','プログラムの確認':'Program check','メッセージで測定':'Measure using messages','台形・S字の比較':'Compare ramp profiles','確認しています…':'Checking…','走行と計測を並行':'Drive and measure in parallel','追加機能の使い方':'Additional features guide','B・Cの角度を計測':'Measure B / C angles','EV3だけで動かす':'Run without a computer','EV3の接続・転送':'EV3 connection / transfer','EV3本体のボタン':'Brick buttons','① 開始角度を記録':'① Record starting angles','③ 終了角度を読む':'③ Read final angles','この端末に自動保存':'Autosaved on this device','センサーの値を表示':'Show sensor values','タイマーとリセット':'Timer / reset','マニュアル PDF':'PDF manual','使い方・テスト手順':'Help / testing','先生用の設定・計測':'Teacher settings / measurements','接続・転送を閉じる':'Close connection panel','本体の画面への表示':'Display on brick','確認結果を共有する':'Share test results','転送して実行・停止':'Transfer, run and stop','CSVログを取り出す':'Export CSV log','PDFをダウンロード':'Download PDF','バッテリー電圧・電流':'Battery voltage / current','ポートの接続機器と値':'Connected devices / values','マイブロックの作り方':'Creating My Blocks','マイブロックの戻り値':'My Block results','ログ名（拡張子なし）':'Log name (no extension)','停止時刻の記録を読む':'Read stop timing record','変数・演算・条件分岐':'Variables, operators and conditions','速度・パワーと実測値':'Speed / power measurements','＋ 新しいプログラム':'+ New program','USBケーブル（有線）':'USB cable (wired)','↑ EV3に転送・照合':'↑ Transfer and verify','サンプルを開きますか？':'Open this sample?','ステアアリングのサンプル':'Steering sample','ステアリングのサンプル':'Steering sample','バッテリーとPID制御':'Battery / PID control',
'ポートを選んで停止する':'Stop selected ports','マイブロックを書き出す':'Export My Blocks','マイブロックを読み込む':'Import My Blocks','共通設定とマイブロック':'Shared setup in My Blocks','切り離しても動きます。':'Runs after disconnecting.','引数（必要なときだけ）':'Parameters (optional)','数値関数（絶対値など）':'Math functions','複数の戻り値（和と差）':'Multiple results (sum / difference)','途中で左右モーター変更':'Change movement motors','CSV・リストのサンプル':'CSV / list sample','EV3同期制御（検証用）':'EV3 synchronized control (experimental)','ジャイロの角度・回転速度':'Gyro angle / angular speed','タッチで終了（イベント）':'Stop on touch (event)','モーター追加機能の使い方':'Additional motor features','Bluetooth（無線）':'Bluetooth (wireless)','PID計算（モーターなし）':'PID calculation (no motors)','↓ EV3からCSVを保存':'↓ Export CSV from EV3','マニュアルをブラウザで読む':'Read the manual in your browser','並行処理・イベントの使い方':'Parallel tasks / events guide','各モーターの指定角度を優先':'Prioritize each motor’s target angle','左右別速度で角度・時間指定':'Separate speeds for angle / time','転送後の「照合完了」を確認':'Check for verification complete','停止タイミングを補正（試作）':'Correct stop timing (experimental)','実行ファイル（.rbf）を保存':'Save executable (.rbf)','新しいプログラムの作成を始めます':'Create a new program','Bluetooth / 標準EV3':'Bluetooth / standard EV3','ブロックで考える。EV3で確かめる。':'Think in blocks. Try it on EV3.','指定したプロジェクト → 転送した名前':'Project folder → transferred program','「マイブロックを作る」で名前と引数を設定':'Use “Create My Block” to add a name and parameters','本体に保存すれば、Chromebookを':'Save on the brick to run after disconnecting your Chromebook.','選んだ2ポートの制御方式（角度・前進・後退）':'Control method for the selected pair (angle / forward / backward)','EV3に接続して「値を読む」を押してください。':'Connect EV3, then press “Read values”.','すべてのブロックが見える倍率と位置に調整します':'Fit all blocks into the workspace','いくつかの命令をまとめて、名前を付けて使えます。':'Group commands into a named My Block.','EV3 Block Lab · 非公式の実験用ツール':'EV3 Block Lab · Unofficial experimental tool','プログラム名：半角英数字・「-」「_」で1〜31文字':'Program name: 1–31 ASCII letters, digits, - or _','プロジェクト名：半角英数字・「-」「_」で1〜31文字':'Project name: 1–31 ASCII letters, digits, - or _',
'呼び出すたびに変えたい数値に名前を付けます。例：距離、速さ':'Name numeric inputs that may change for each call, such as distance or speed.','問題が起きたら、このログとプロジェクトを共有してください。':'If a problem occurs, share this log and the project file.','接続してから転送できます。転送だけではモーターは動きません。':'Connect before transferring. Transfer alone does not start the motors.','現在のモードの値を表示します。表示中もセンサーのモードは変更しません。':'Shows values in the current sensor mode without changing it.','EV3の保存先フォルダ。半角英数字・ハイフン・アンダースコアで31文字まで':'EV3 destination folder. Up to 31 ASCII letters, digits, - or _.','「転送して実行」は照合後すぐに動き始めます。本体の戻るボタンでも停止できます。':'“Transfer and run” starts immediately after verification. The brick’s Back button also stops it.','初回は「音だけ」がおすすめです。モーターを試すときは、車輪を浮かせてください。':'Start with “Sound only”. Lift the wheels when testing motors.','保存ファイルとEV3のプログラム名。半角英数字・ハイフン・アンダースコアで31文字まで':'Saved file and EV3 program name. Up to 31 ASCII letters, digits, - or _.','編集中のプログラムを置き換えます。残したい場合は、キャンセルして先に「保存」してください。':'This replaces the current program. To keep it, cancel and save first.','補正中に一定時間進めない場合は、全モーターを停止し、低い音を鳴らしてプログラムを終了します。':'If a corrected move stalls for too long, all motors stop and the program ends with a low tone.','Windowsで基本動作確認済み · Chromebookは検証待ち · 編集データはこのブラウザに保存':'Basic Windows operation tested · Chromebook testing pending · Projects stored in this browser','照合完了時にEV3から短い完了音が鳴ります。Bluetooth・USBともに、転送後は本体だけで実行できます。':'EV3 plays a short sound after verification. After Bluetooth or USB transfer, the program runs on the brick independently.','実行を停止してから、現在のプロジェクトフォルダ内のログを取り出します。本体だけで実行した後も再接続して取得できます。':'Stop execution before exporting a log from the current project folder. Reconnect to retrieve logs recorded without a computer.','名前は半角英数字・ハイフン・アンダースコアで1〜31文字。プロジェクト名はEV3のフォルダ名、プログラム名は保存ファイル名です。':'Use 1–31 ASCII letters, digits, - or _. Project name is the EV3 folder; program name is the saved filename.','保存先の名前は画面左上で入力します。同じプロジェクト名・プログラム名への転送は上書きします。実行中は本体で停止してから転送してください。':'Enter destination names at the top left. Transferring the same project and program names overwrites the existing file. Stop a running program on the brick first.',
'最後に完了した補正ブロックの記録を表示します。完了信号を20ミリ秒間隔で観測した時刻で、物理的な停止の厳密な時刻とは異なる場合があります。':'Shows the last completed corrected move. Completion signals are sampled every 20 ms; these times may differ from the exact physical stop.','0.1.6以降で補正モードを再転送し、本体で1回実行した後に読み取ります。開始時の記録ボタンは不要です。PCを切り離した実行でも記録されます。':'Transfer a corrected-mode program (v0.1.6 or later), run it once on the brick, then read the record. No starting record is needed. Recording also works when disconnected.','変数単体のブロックは「変数」グループに名前ごとに表示されます。「○にする」「○ずつ増やす」はプルダウンで変数名を選びます。引数とは別の名前を付けてください。':'Variable reporters appear by name in Variables. Choose a name from the dropdown in set / change blocks. Use names distinct from parameters.','接続した状態で、①開始角度を記録 → ②EV3本体で今回のプログラムを実行 → ③停止後に終了角度を読む。途中で本体を再起動したり、軸を手で回したりしないでください。':'While connected: record starting angles, run the current program on EV3, then read final angles after stopping. Do not restart the brick or turn the shafts by hand between readings.','自動更新は約0.5秒の間隔で順に読み取ります。転送時は一時停止します。赤外線のリモコン・ビーコンはCH1の先頭値です。ジャイロの角度はプログラム内のリセットを反映しないセンサ生値です。':'Auto-update reads sequentially about every 0.5 s and pauses during transfer. IR remote / beacon shows the first CH1 value. Gyro monitoring shows raw angles without the program’s reset offset.',
'✓ この端末に自動保存済み':'✓ Autosaved on this device','✓ 転送用プログラムを生成できます':'✓ Program can be generated','編集 · 自動保存したプロジェクトを復元しました。':'Editor · Restored the autosaved project.','自動保存したプロジェクトを復元しました。':'Restored the autosaved project.','ブロックを修正すると、自動で確認します。':'Checks update automatically when you edit blocks.','自動保存できません。「保存」でファイルを保存してください。':'Autosave failed. Use Save to download a project file.','サンプルを読み込みました。':'Sample loaded.','新しいプログラムを作りました。マイブロックの読み込みもできます。':'New program created. You can also import My Blocks.','プロジェクトを読み込みました。':'Project loaded.','読み込めませんでした。':'Could not load. ','サンプルを開けませんでした。':'Could not open sample. ','「変数」グループに変数のブロックを追加しました。':'Added the variable reporter to Variables.','ファイルは2MB以下にしてください。':'Files must be 2 MB or smaller.','戻り値は8個までです。':'Use at most 8 results.','引数は8個までです。':'Use at most 8 parameters.','変更を保存':'Save changes','マイブロックを編集':'Edit My Block','転送・通信が終わってから言語を切り替えてください。':'Wait for communication or transfer to finish before changing language.',
'接続して「値を読む」を押してください。':'Connect and press “Read values”.','読み取っています…':'Reading…','読み取れませんでした。':'Could not read. ','CSVを保存しました。EV3本体の記録は残っています。':'CSV exported. The original log remains on EV3.','EV3からCSVを読み出しています…':'Reading CSV from EV3…','ログを消去しました':'Log cleared','EV3へプログラムと全モーターの停止命令を送信しました。':'Sent commands to stop the EV3 program and all motors.','停止を確認できません。本体の戻るボタンで停止してください。':'Stop could not be confirmed. Press Back on the brick. ','転送未完了：':'Transfer incomplete: ','送信完了。EV3から読み戻して照合しています…':'Upload complete. Reading back for verification…','本体に保存しています…':'Saving to the brick…','EV3へ完了音を送信しました。':'Sent the completion tone to EV3.','本体でこのプログラムを選んで実行してください。':'Select and run this program on the brick.','今回のプログラムの起動命令を送信しました。止めるときは「実行を停止」を押してください。':'Sent the start command. Press Stop program to stop.','EV3を確認しました。「転送・照合」で本体に保存できます。':'EV3 detected. Use Transfer and verify to save on the brick.','接続先の選択をキャンセルしました。':'Device selection cancelled.','切断しました。':'Disconnected.','EV3のBluetoothシリアルポートを選んでください。':'Select the EV3 Bluetooth serial port.','USBケーブルをEV3のPC端子につなぎ、選択画面でEV3を選んでください。':'Connect a USB cable to EV3’s PC socket, then select EV3.','Windows／ChromebookのBluetooth設定でEV3をペアリングし、シリアルポートを選びます。':'Pair EV3 in Windows / Chromebook Bluetooth settings, then choose its serial port.','USBケーブルをEV3のPC端子につないでください。接続時にEV3を選択します。学校の端末では利用許可が必要な場合があります。':'Connect a USB cable to EV3’s PC socket and select EV3 when connecting. Managed school devices may require permission.','HTTPSで開いてください。':'Open this site using HTTPS.','USB接続に非対応です。パソコン／ChromebookのChromeで開いてください。':'USB is not supported here. Open in Chrome on a PC / Chromebook.','Bluetooth接続に非対応です。Chromeで開いてください。':'Bluetooth serial is not supported here. Open in Chrome.',
'動きに使うモーターを設定してください':'Set the movement motors first','距離で動かす前に、タイヤの直径を設定してください。':'Set wheel diameter before moving by distance.','「スタート」の下にブロックをつなげてください。':'Connect blocks below Start.','数値・条件の空欄にブロックを入れてください。':'Fill empty number / condition inputs with blocks.','2モーターの制御方式を変更しました。反映するには再転送が必要です。':'Two-motor control method changed. Transfer again to apply it.','丸い呼び出しブロックで使う値を選びます。選び直すと、そのマイブロックをもう一度実行します。':'Choose a result on the round call block. Each call runs the My Block again.',
'バイト':'bytes','EV3標準形式':'EV3 standard format','加減速（試作）':'ramp control (experimental)','小数計算対応':'decimal arithmetic','センサは本体実行時に読み取り':'sensors read during brick execution','照合完了':'Verification complete','保存先：':'Destination: ','バイト一致':'bytes matched','未接続／故障中':'not connected / unavailable','超音波・距離':'ultrasonic / distance','回転角度':'rotation angle','更新 ':'Updated ','計測開始':'Measurement start','計測結果':'Measurement result','編集':'Editor','定義':'define','返す値':'return','自動保存':'Autosave','名前':'name','戻り値':'result'
});
Object.assign(T,{
'旋回前にタイヤ直径・トレッドを設定':'Set wheel diameter and track width before turns',
'加速・減速（L・M共通）':'Acceleration / deceleration (L and M)','L・M共通の速度・パワー・停止方法':'Speed / power / stop behavior (L and M)','モーターを停止（L・M共通）':'Stop motors (L and M)',
'EV3 バッテリー':'EV3 battery','モーターのエンコーダ':'Motor encoders','PID制御':'PID control','センサ・比較を条件の欄に入れます':'Put a sensor or comparison in the condition input','名前が同じメッセージで連携します':'Coordinate tasks with matching message names','EV3本体：178×128ドット／左上が0,0':'EV3 screen: 178×128 pixels / origin at top left','文字列（UTF-8で120バイトまで）':'Text (up to 120 UTF-8 bytes)','数値リスト（同じ名前で共有）':'Numeric lists (shared by name)','プログラム全体で使う変数':'Variables shared across the program','「変数をつくる」で名前を付けます':'Use Create variable to add a name','定義の中だけで使う引数':'Parameters used inside definitions','「マイブロックを作る」で引数を追加します':'Use Create My Block to add parameters','同じ名前を定義したマイブロックで使えます':'Use inside a My Block that defines the same name','名前・引数・戻り値を編集':'Edit name, parameters and results','まで繰り返す':'repeat until','の間繰り返す':'repeat while',
'変数の名前を1〜40文字で入力してください。':'Enter a variable name of 1–40 characters.','同じ名前の変数または引数があります。別の名前を付けてください。':'A variable or parameter already has this name. Choose another name.','マイブロックの名前を1〜60文字で入力してください。':'Enter a My Block name of 1–60 characters.','同じ名前のマイブロックがあります。':'A My Block already has this name.','マイブロックは32個までです。':'Use at most 32 My Blocks.','引数は8個まで、名前は1〜40文字で入力してください。':'Use at most 8 parameters, with names of 1–40 characters.','引数には別々の名前を付けてください。':'Give each parameter a different name.','戻り値は重複しない名前で1〜8個、名前は1〜40文字にしてください。':'Use 1–8 uniquely named results, with names of 1–40 characters.','戻り値を1個以上追加してください。':'Add at least one result.','使っている引数は削除できません。定義の中の引数ブロックを先に外してください。':'Disconnect parameter reporters inside the definition before deleting a parameter.','戻り値の有無を変える前に、この定義の呼び出しブロックを削除してください。形が変わるため、変更後に置き直します。':'Delete this definition’s calls before changing command / result type, then recreate them.','戻り値の数を変える前に呼び出しブロックを削除し、変更後に置き直してください。':'Delete calls before changing the result count, then recreate them.','削除する戻り値の計算ブロックを先に外してください。':'Disconnect calculations attached to results before deleting them.','返す値のブロックを先に外してください。':'Disconnect the return-value block first.','EV3 Block Labのプロジェクト（バージョン1）を選んでください。':'Select an EV3 Block Lab project (format version 1).','プロジェクトは2MB以下にしてください。':'Projects must be 2 MB or smaller.','「スタート」またはイベントのブロックを置いてください。':'Add a Start or event block.','スタート・イベント・メッセージ受信は合計16個までです。':'Use at most 16 Start, event and message receiver blocks combined.','以前の作品です。「動きに使うモーター」を追加し、左右の配線を再確認してください。B+Cは自動設定しません。':'This older project needs Set movement motors. Check left/right wiring; B+C is not selected automatically.',
'丸い呼び出しで「和」「差」を選びます。それぞれ呼び出すたびに定義を実行します。本体画面の上に660、下に220を表示し、660Hzの音を鳴らします。モーターは動かしません。':'Choose sum or difference on each round call. Each call runs the definition. Displays 660 and 220, then plays 660 Hz. No motors move.','平均の戻り値を音の周波数に使います。440と880の平均、660Hzで鳴らします。モーターは動かしません。':'The average of 440 and 880 sets the tone to 660 Hz. No motors move.','左B・右Cをスタート直後に設定します。実際の配線・直径を確認してください。':'Sets left B / right C immediately after Start. Check actual wiring and diameter.','LモーターB+Cを速さ20％で回し、ポート4の超音波センサが15cm未満になったら停止します。':'Runs L motors B+C at 20%, then stops when ultrasonic input 4 is below 15 cm.','カラーセンサをポート3に接続し、赤い物を近づけると音が鳴ります。':'Connect a color sensor to input 3. Showing red triggers the tone.','回数を1ずつ増やし、2回目だけ高い音を鳴らします。':'Increments the count and plays a higher tone only on iteration 2.',
'定義の各「返す値」に計算式を入れます。丸い呼び出しの「戻り値」で使う値を選びます。呼び出すたびに定義を実行します。':'Put a calculation in each result input. Choose the result on a round call. Each call executes the definition.','定義の「返す値」に数値・演算などを入れます。マイブロックの丸い呼び出しを数値入力へ入れて使います。':'Put a number or calculation in the return input. Use a round My Block call in a numeric input.','定義の中に命令をつなぎ、マイブロックの同じ名前のブロックをスタートにつなげて使います。':'Add commands inside the definition, then connect its matching call below Start.',
'返す値':'return','を編集':'edit','個のマイブロックを書き出しました。':' My Blocks exported.','個のマイブロックを追加しました。定義は編集画面の下側にあります。':' My Blocks added. Definitions are below the current workspace.',
'本体のファイル画面で':'In the brick’s file browser','EV3に保存された停止時刻を読み取っています…':'Reading stop timing records from EV3…','未対応機器':'Unsupported device','未接続／認識中':'not connected / detecting','数値を返す':'Return numbers','メッセージ1':'Message1'
});
Object.assign(catalog.tips,{
ev3_return_value:'Return a numeric value immediately from a result-producing My Block, including from inside a loop or condition.',
ev3_stop_port:'Legacy selected-port stop: coast releases immediately, brake applies for about 100 ms then releases, and hold controls position while the program is active. Configured mode uses the last executed end-behavior setting.',
ev3_tread:'Measure the distance between the wheel centers. Execute this before a turn. It may be grouped in a setup My Block.',
ev3_wheel:'Set the actual outside wheel diameter before distance moves or turns. May be grouped in a setup My Block. Assumes directly driven L motors.',
ev3_brick_button:'Read the current button state, not a remembered press event. Any includes up, down, left, right and center. Back is reserved for stopping.',
ev3_brick_button_value:'Return 1 while the selected button is pressed, otherwise 0.',
ev3_timer:'Seconds since program start or the last reset, including decimals. This timer is shared by all tasks and My Blocks.',
ev3_timer_reset:'Reset the shared timer to zero. Does not change motor or wait commands.',
ev3_encoder_reset:'Reset only the selected motor encoder to zero. Does not move the motor or affect other ports.',
ev3_encoder:'Read signed cumulative motor-shaft degrees. Does not wrap at 360 or reset on read. Subtract a saved baseline for relative travel.',
ev3_touch:'Read the touch sensor’s current state, not a remembered press event.',ev3_touch_value:'Return 1 while pressed, otherwise 0.',
ev3_led:'Change the brick light and continue immediately. Add a wait to observe it. Normal firmware behavior resumes after program termination.'
});
for(const op of ['add','sub','mul','div','lt','eq','gt','lte','gte','neq','and','or'])catalog.tips['ev3_op_'+op]=op==='div'?'Divide, preserving decimals. Division by zero is invalid.':'Use matching numeric or condition reporters on both sides.';
Object.assign(T,{
'小':'small','大':'large','「動作後の停止方法」の設定':'configured end behavior',
'戻り値は最大8個です。丸い呼び出しの「戻り値」で使う値を選びます。呼び出すたびに定義内の命令を実行します。':'Add up to 8 named results. Select one on the round call; every call runs the definition.',
'「数値を返す」を選んだ場合は、定義の各「返す値」に計算式などを入れます。丸い呼び出しを数値欄に入れ、「戻り値」で使う値を選びます。作成後は、定義の中に命令をつなぎます。「引数」グループから引数を取り出せます。編集はマイブロックの「編集」ボタンから開きます。':'For numeric results, place calculations in the definition’s return inputs and use a round call in a numeric input. Select the result on that call. Add commands inside the definition and use reporters from Parameters. Reopen the dialog using the My Block edit button.',
'文字列・リストの名前は1〜40文字にしてください。':'Text / list names must have 1–40 characters.','文字列はUTF-8で120バイト以内（日本語は通常40文字以内）にしてください。':'Text must fit in 120 UTF-8 bytes (usually up to 40 Japanese characters).','文字列の入力を確認してください。':'Check the text input.','ログ名は半角英数字・-・_で1〜31文字にしてください。':'Log names require 1–31 ASCII letters, digits, - or _.','文字列変数とリストは、それぞれ16個までです。':'Use at most 16 text variables and 16 lists.','動きの左右には異なるモーターポートを選んでください。':'Select different motor ports for left and right movement.','左右には異なるモーターポートを選んでください。':'Select different left and right motor ports.','マイブロックの再帰呼び出しは使えません。':'Recursive My Block calls are not supported.','試作版ではマイブロックの再帰呼び出しは使えません。':'Recursive My Block calls are not supported.','EV3に保存する名前は、半角英数字・「-」「_」で1〜31文字にしてください。':'EV3 program names require 1–31 ASCII letters, digits, - or _.','EV3のプロジェクト名は、半角英数字・「-」「_」で1〜31文字にしてください。':'EV3 project names require 1–31 ASCII letters, digits, - or _.','整数の範囲を超えています。':'Integer range exceeded.','平方根には0以上の数を入れてください。':'Square root requires a nonnegative input.','対数には0より大きい数を入れてください。':'Logarithms require a positive input.','asin・acosには−1〜1の数を入れてください。':'asin / acos require an input between -1 and 1.','この角度のtanは計算できません。':'tan is undefined at this angle.','0では割れません。':'Cannot divide by zero.','本体ボタンを選んでください。':'Select a brick button.','センサの種類・ポートを確認してください。':'Check the sensor type and port.','赤外線センサのチャンネルは1〜4から選んでください。':'Select infrared channel 1–4.','数値を確認してください。':'Check the numeric input.','バッテリーの測定項目を確認してください。':'Check the battery measurement type.','乱数は−32767〜32767の整数範囲で、下限≦上限にしてください。':'Random bounds must be integers in -32767..32767, with lower <= upper.','範囲の下限を上限以下にしてください。':'The lower bound must not exceed the upper bound.','文字列の演算を確認してください。':'Check the text operation.','リストの演算を確認してください。':'Check the list operation.','旋回の前に、トレッドを設定してください。':'Set track width before turning.','走行用の異なる2個のモーターポートを選んでください。':'Choose two distinct movement motor ports.','マイブロック名が重複しています。':'Duplicate My Block names.','引数は重複のない名前で8個までです。':'Use at most 8 uniquely named parameters.','戻り値は1〜8個にしてください。':'Use 1–8 results.','数値を返すマイブロックを選んでください。':'Choose a My Block that returns a number.','数値を返すマイブロックは値の入力欄で使ってください。':'Use numeric My Block calls in value inputs.','戻り値の選択を確認してください。':'Check the selected result.','実行する処理が多すぎます。繰り返し回数を減らしてください。':'Too many operations. Reduce repeat counts.','ステアリングの左右には異なるポートを選んでください。':'Choose different left and right steering ports.','有限走行の速さは0以外にしてください。':'Finite moves require a nonzero speed.','走行時間は0より大きく60秒以下にしてください。':'Movement duration must be greater than 0 and at most 60 seconds.','加速・減速時間は0〜10秒にしてください。':'Acceleration and deceleration must be 0–10 seconds.','タイヤの直径は10〜200 mmにしてください。':'Wheel diameter must be 10–200 mm.','トレッドは10〜1000 mmにしてください。':'Track width must be 10–1000 mm.','左右の速さを両方0にはできません。':'Left and right speed cannot both be zero for a finite move.','走行時間は0.001〜60秒にしてください。':'Movement duration must be 0.001–60 seconds.','モーターポートは2個まで指定できます。':'Select at most two motor ports.','1個のモーターブロックで指定できるポートは2個までです。':'A motor block can select at most two ports.','角度指定のモーター速度を0にはできません。':'Angle-controlled moves require a nonzero motor speed.','補正制御では、角度を減らすか速度を上げてください（監視時間の上限3分）。':'For correction mode, reduce angle or increase speed (3-minute watchdog limit).','待ち時間は0〜60秒にしてください。':'Wait duration must be 0–60 seconds.','モーターの速さは0以外にしてください。':'Motor speed must be nonzero.','モーターの時間は0より大きく60秒以下にしてください。':'Motor duration must be greater than 0 and at most 60 seconds.','メッセージ名は1〜40文字にしてください。':'Message names must have 1–40 characters.','返す値の数を定義の戻り値とそろえてください。':'Return all the results specified by the definition.','数値を返すマイブロックでは、値を返す終了ブロックを使ってください。':'Use a return-value exit in a numeric My Block.','マイブロックの終了は定義の中だけで使えます。':'My Block exits are valid only inside a definition.','変数は32個までです。':'Use at most 32 numeric variables.','プログラムが大きすぎます（上限64KB）。':'Program is too large (64 KB limit).','停止方法を選んでください。':'Select a stop method.','値を返す終了ブロックは、数値を返すマイブロックの中だけで使えます。':'Return-value exits are only valid inside numeric My Blocks.',
'モーターポート':'motor ports','停止するモーターポート':'motor ports to stop','左モーターの速さ':'left motor speed','右モーターの速さ':'right motor speed','モーターの速さ':'motor speed','外側モーターの角度':'outer motor angle','速い側のモーターの角度':'faster motor angle','ランプの色':'brick light color','音量':'volume','音の長さ':'tone duration','周波数':'frequency','計算結果':'calculation result','待ち時間':'wait duration','回転角度':'rotation angle','回転数':'rotations','ステアリング':'steering','速度':'speed','速さ':'speed','角度':'angle',
'は、その引数を定義したマイブロックの中につなげてください。':' must be used inside a My Block that defines it.','は、このマイブロックの中だけで使用できます。':' may only be used inside its My Block.','はマイブロックの中だけで使用できます。':' may only be used inside its My Block.','の定義がありません。':' has no definition.','の引数の数が一致しません。':' has a different parameter count.','未対応のブロック: ':'Unsupported block: ','が計算できる範囲を超えています。':' exceeds the finite numeric range.',
'保存先':'Destination','接続中です。先に切断してください。':'Already connected. Disconnect first.','HTTPSのページ、またはlocalhostで開いてください。':'Open using HTTPS or localhost.','このブラウザではBluetooth接続を使えません。Chromeで開いてください。':'Bluetooth serial is unavailable. Open in Chrome.','標準ファームウェアで起動したEV3を選んでください。':'Select EV3 running standard firmware.'
});
