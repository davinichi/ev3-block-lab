// 通信で取得した数値を画面用のラベルと文字列へ整形する。測定やセンサモード変更は行わない。
// 赤外線の複数データでは、現在の読み取り方式が返すCH1の先頭値だけを表示する。
export function sensorReading({type,mode,value}){
 const names={16:'タッチ',29:'カラー',30:'超音波',32:'ジャイロ',33:'赤外線'},modes={
  16:{0:['押下', ''],1:['押下回数','回']},
  29:{0:['反射光','%'],1:['周囲光','%'],2:['色番号','']},
  30:{0:['距離','cm'],1:['距離','inch'],2:['検出','']},
  32:{0:['角度（センサ生値）','度'],1:['回転速度','度／秒'],3:['角度（センサ生値）','度']},
  33:{0:['近さ','%'],1:['ビーコンCH1方向',''],2:['リモコンCH1番号','']}
 };
 // 未接続・認識中・未対応種類を数値0と区別する。値が取れていない状態を測定結果として表示しない。
 if(!names[type])return {label:[0,125,126,127].includes(type)?'未接続／認識中':`種類 ${type}・モード ${mode}`,text:'—'};
 const [name,unit]=modes[type][mode]??[`モード ${mode} の先頭値`,''];
 if(value===null||!Number.isFinite(value))return {label:`${names[type]}・${name}`,text:'読み取り待ち'};
 const colors=['なし','黒','青','緑','黄','赤','白','茶'];
 const text=type===16&&mode===0?(value===1?'押されている':'離されている'):type===29&&mode===2?`${colors[Math.round(value)]??'不明'}（${value}）`:`${Math.round(value*100)/100}${unit?' '+unit:''}`;
 return {label:`${names[type]}・${name}`,text};
}
