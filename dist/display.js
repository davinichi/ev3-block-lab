// 本体の178×128ドット画面。画像を走査線の命令へ変換し、外部画像ファイルを不要にする。
export const DISPLAY_IMAGES=[['えがお','smile'],['かなしい顔','sad'],['びっくりした顔','surprise'],['ハート','heart'],['チェック','check'],['ばつ','cross'],['上矢印','up'],['下矢印','down'],['左矢印','left'],['右矢印','right']];
export function presetBitmap(name,size=48){
 if(!DISPLAY_IMAGES.some(x=>x[1]===name)||![48,96].includes(size))throw Error('画像・大きさを選んでください。');
 const rows=[];
 for(let py=0;py<size;py++){
  let row='';for(let px=0;px<size;px++){
   let x=(px+.5)*48/size,y=(py+.5)*48/size,on=false;
   if(['smile','sad','surprise'].includes(name)){
    const r=Math.hypot(x-24,y-24);on=r>=20&&r<22;
    on ||= Math.hypot(x-16,y-18)<2.5||Math.hypot(x-32,y-18)<2.5;
    if(name==='surprise')on ||= Math.abs(Math.hypot((x-24)*1.3,y-31)-5)<1.5;
    else{const cy=name==='smile'?23:40;on ||= x>=13&&x<=35&&Math.abs(Math.hypot(x-24,y-cy)-12)<1.4&&(name==='smile'?y>28:y<35);}
   }else if(name==='heart'){
    const a=(x-24)/18,b=(25-y)/18;on=(a*a+b*b-1)**3-a*a*b*b*b<0;
   }else if(name==='cross')on=(Math.abs(x-y)<2.5||Math.abs(x+y-48)<2.5)&&x>8&&x<40&&y>8&&y<40;
   else if(name==='check')on=(x>=8&&x<=21&&Math.abs(y-(x+12))<2.6)||(x>=19&&x<=40&&Math.abs(y-(54-x))<2.6);
   else{
    if(name==='down'){x=48-x;y=48-y;}else if(name==='left'){const a=x;x=48-y;y=a;}else if(name==='right'){const a=x;x=y;y=48-a;}
    on=(y>=6&&y<=25&&Math.abs(x-24)<=y-5)||(x>=19&&x<=29&&y>=22&&y<=42);
   }
   row+=on?'1':'0';
  }rows.push(row);
 }return {width:size,height:size,rows};
}
const textCache=new Map();
export function rasterDisplayText(text,size=16){
 if(typeof text!=='string'||!text.length||text.length>120||! [12,16,24].includes(size))throw Error('画面の文字は1〜120文字、大きさは12・16・24から選んでください。');
 const key=size+'|'+text;if(textCache.has(key))return textCache.get(key);
 const canvas=document.createElement('canvas');canvas.width=178;canvas.height=128;const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw Error('文字の画像変換ができません。');
 ctx.font=size+'px sans-serif';ctx.textBaseline='top';
 const lines=[''];for(const char of text){if(char==='\n'){lines.push('');continue;}if(ctx.measureText(lines.at(-1)+char).width>178)lines.push(char);else lines[lines.length-1]+=char;}
 const height=lines.length*(size+3);if(height>128)throw Error('文字が本体の画面に入りません。文字数や大きさを減らしてください。');
 const width=Math.max(1,Math.ceil(Math.max(...lines.map(line=>ctx.measureText(line).width))));
 ctx.fillStyle='white';ctx.fillRect(0,0,178,128);ctx.fillStyle='black';lines.forEach((line,i)=>ctx.fillText(line,0,i*(size+3)));
 const pixels=ctx.getImageData(0,0,width,height).data,rows=[];
 for(let y=0;y<height;y++){let row='';for(let x=0;x<width;x++)row+=pixels[(y*width+x)*4]<160?'1':'0';rows.push(row);}
 const result={width,height,rows};if(textCache.size>=32)textCache.delete(textCache.keys().next().value);textCache.set(key,result);return result;
}
export function validateDisplay(b){
 if(b.type==='displayClear')return;
 if(!Number.isInteger(b.x)||!Number.isInteger(b.y)||b.x<0||b.y<0||b.x>177||b.y>127)throw Error('画面の位置は横0〜177、縦0〜127の整数です。');
 if(b.type==='displayNumber'){
  if(![0,2].includes(b.font)||!Number.isInteger(b.decimals)||b.decimals<0||b.decimals>3)throw Error('数値の文字の大きさ・小数の桁数を確認してください。');
  if(b.x+(b.font===2?160:80)>178||b.y+(b.font===2?19:9)>128)throw Error('数値の表示欄が画面からはみ出します。位置・大きさを変更してください。');return;
 }
 const m=b.bitmap;
 if(!m||!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<1||m.width>178||m.height<1||m.height>128||!Array.isArray(m.rows)||m.rows.length!==m.height||m.rows.some(row=>typeof row!=='string'||row.length!==m.width||!/^[01]+$/.test(row)))throw Error('画面の画像データが不正です。');
 if(b.x+m.width>178||b.y+m.height>128)throw Error('文字・画像が画面からはみ出します。位置・大きさを変更してください。');
}
export function emitDisplay(b,{emit,constant:C,floatExpr,guard,floatGuard}){
 const draw=(cmd,...args)=>emit(0x84,C(cmd),...args.map(C));
 // 1命令の表示単位を共有ロックで保護する（呼び出し側）。TOPLINEで上端も描画領域にする。
 draw(18,0);
 if(b.type==='displayClear')draw(1);
 else if(b.type==='displayNumber'){
  const value=floatExpr(b.value);floatGuard(value);
  draw(17,b.font);draw(9,0,b.x,b.y,b.font===2?160:80,b.font===2?19:9);
  emit(0x84,C(8),C(1),C(b.x),C(b.y),value,C(-10),C(b.decimals));
 }else{
  const m=b.bitmap;draw(9,0,b.x,b.y,m.width,m.height);
  // 黒いドットの連続部分を線にまとめる。日本語も同じ方法で単独実行できる。
  for(let y=0;y<m.height;y++)for(let x=0;x<m.width;){if(m.rows[y][x]==='0'){x++;continue;}const start=x;while(x<m.width&&m.rows[y][x]==='1')x++;draw(3,1,b.x+start,b.y+y,b.x+x-1,b.y+y);}
 }
 draw(0);
}
