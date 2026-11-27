import {OTHER_LIMITATIONS} from './ev3rt-other-limits.js';
import {MOTOR_LIMITATIONS} from './ev3rt-motor-limits.js';
// The compatibility catalogue describes the C exporter, not hardware validation.
const result=(status,ja,en)=>({status,ja,en,known:true});
const yes=(ja='Cソース出力に対応しています。',en='Supported by the C exporter.')=>result('supported',ja,en);
const maybe=(ja,en)=>result('conditional',ja,en);
const no=(ja,en)=>result('unsupported',ja,en);
export const EV3RT_REQUIREMENTS=[
  {id:'TARGET',ja:'実行先：EV3をEV3RT／TOPPERS HRP3で起動します。HRP2とは時間単位・SDKが異なります。',en:'Target: boot EV3RT / TOPPERS HRP3. HRP2 uses a different SDK and time units.'},
  {id:'SOURCE',ja:'Cソースを保存するだけ：ブラウザーで利用できます。補助アプリやコンパイラーの準備は不要です。',en:'Saving C source only: the browser is sufficient; no companion or compiler is required.'},
  {id:'BUILD',ja:'アプリ内コンパイル：この構成ではWindows PCにNode.js 24、Cygwinのmake・perl・gcc-coreなど、ARM GCC 5.4を準備します。RubyとHRP3 SDKは補助アプリに同梱しています。',en:'In-app compilation: this configuration uses Windows with Node.js 24, Cygwin make/perl/gcc-core, and ARM GCC 5.4. Ruby and the HRP3 SDK are bundled.'},
  {id:'HELPER',ja:'補助アプリの版：v0.34.2対応版以降（機能版12以上）が必要です。サイトの「補助アプリに接続」で自動確認します。接続時に機能版12以上を確認します。起動画面にも機能版・ビルド情報を表示します。古い版の場合だけ、起動画面を閉じ、このサイトのZIPを全展開してstart-ev3rt.cmdを起動します。',en:'Companion version: v0.34.2-compatible or later (capability version 12+). Connect checks it automatically. Capability version 12 or later is checked on connection; the startup window identifies the capability and build. Only replace older versions using the ZIP on this site.'},
  {id:'CONNECTION',ja:'PC内への接続：補助アプリはブラウザーと同じPCで起動します。ブラウザーから求められた場合は、このサイトから補助アプリへのローカルネットワーク接続を許可します。',en:'Local connection: run the companion on the same PC as the browser. Allow this site to connect to it if the browser requests local-network permission.'},
  {id:'TRANSFER',ja:'転送する場合：Bluetooth PANのペアリング＋PAN参加と本体の受信待ち、またはPCから書き込めるmicroSDを用意します。通常のBluetoothシリアル接続とは別の方式です。',en:'Transfer: pair and join Bluetooth PAN with the brick waiting to receive, or use a microSD accessible from the PC. This differs from ordinary Bluetooth serial.'}
];
// Export the same catalogue shown in the dialog, without depending on a connection.
export function supportDownloads(rows,{english=false,version='',generatedAt=new Date().toISOString()}={}) {
  const tr=(ja,en)=>english?en:ja,escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statuses={supported:tr('対応','Supported'),conditional:tr('条件付き','Conditional'),unsupported:tr('未対応','Unsupported')};
  const kinds={unsupported:tr('公開APIで未対応','Unavailable through public API'),constraint:tr('組合せの制約','Combination constraint'),difference:tr('動作・運用の相違','Behavior / workflow difference'),implementation:tr('現在の実装上の制限','Current implementation limit')};
  const limits=[...OTHER_LIMITATIONS,...MOTOR_LIMITATIONS],title=tr('EV3-RT ブロック対応表','EV3-RT block support');
  const note=tr('全項目、動作上の制約・相違点、必須要件（環境・準備）を別々に収録しています。検索・絞り込みは反映しません。Cソース生成の対応状況であり、実機の動作・精度を保証するものではありません。','Includes block support, behavioral limitations and prerequisites as separate sections, regardless of filters. This describes C source generation, not verified hardware behavior or accuracy.');
  const head=[tr('分類','Section'),tr('カテゴリ','Category'),tr('ブロック・項目','Block / item'),tr('対応・制約の分類','Support / limitation kind'),tr('条件・説明','Conditions / details'),tr('識別子','Identifier')];
  const records=[...rows.map(r=>[tr('ブロック','Block'),r.category,r.name,statuses[r.status],english?r.en:r.ja,r.type]),...limits.map(r=>[tr('制約・相違点','Limitations / differences'),'',r.id,kinds[r.kind],english?r.en:r.ja,r.id]),...EV3RT_REQUIREMENTS.map(r=>[tr('必須要件','Prerequisites'),'',r.id,tr('環境・準備','Environment / setup'),english?r.en:r.ja,r.id])];
  // BOM for Excel; quote every cell and neutralize spreadsheet formulas.
  const cell=value=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';
  const csv='\ufeff'+[head,...records].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
  const headers=values=>'<tr>'+values.map(v=>'<th scope="col">'+escape(v)+'</th>').join('')+'</tr>';
  const table=(labels,records)=>'<table><thead>'+headers(labels)+'</thead><tbody>'+records.map(r=>'<tr>'+r.map(v=>'<td>'+escape(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  const html='<!doctype html><html lang="'+(english?'en':'ja')+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title><style>body{font:15px/1.7 system-ui,Meiryo,sans-serif;color:#203c47;margin:0;background:#eef4f5}main{max-width:1200px;margin:auto;padding:28px}h1,h2{color:#08786f}table{width:100%;border-collapse:collapse;background:white;margin:16px 0 32px}th,td{text-align:left;vertical-align:top;padding:10px;border:1px solid #ccdada;overflow-wrap:anywhere}th{background:#e0f0eb}tbody tr:nth-child(even){background:#f5f8f8}.meta{color:#5d747c}small{font-size:12px}@media print{body{background:white;font-size:9pt}main{padding:0}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}}@media(max-width:600px){main{padding:12px}td,th{padding:5px;font-size:12px}}</style><main><p class="meta">EV3 Block Lab RT (EBL-RT)</p><h1>'+escape(title)+'</h1><p class="meta">'+escape(version)+' / '+escape(generatedAt)+'</p><p>'+escape(note)+'</p><p>'+escape(tr('ブラウザーの「印刷」で紙への印刷やPDF保存もできます。','Use the browser Print command to print or save a PDF.'))+'</p><h2>'+escape(tr('ブロック対応一覧','Block support'))+' ('+rows.length+')</h2>'+table(head.slice(1),records.slice(0,rows.length).map(r=>r.slice(1)))+'<h2>'+escape(tr('動作上の制約・相違点','Behavioral limitations and differences'))+'</h2>'+table([head[2],head[3],head[4]],records.slice(rows.length,rows.length+limits.length).map(r=>[r[2],r[3],r[4]]))+'<h2>'+escape(tr('必須要件（環境・準備）','Prerequisites (environment / setup)'))+'</h2>'+table([head[2],head[4]],records.slice(rows.length+limits.length).map(r=>[r[2],r[4]]))+'</main></html>';
  const stem='EBL-RT-support'+(version?'-'+version:'')+(english?'-en':'-ja');
  return {html:{data:html,name:stem+'.html',type:'text/html;charset=utf-8'},csv:{data:csv,name:stem+'.csv',type:'text/csv;charset=utf-8'}};
}
export function blockSupport(type,fields={}) {
  if(/^ev3_(when_|message_)/.test(type))return maybe('HRP3のタスクとして生成。約20ms周期で監視し、同じイベントは重ねて実行しません。送って待つの循環は不可。','Generated as HRP3 tasks. Events poll about every 20ms without overlapping handlers. Cyclic send-and-wait is rejected.');
  if(/^ev3_(text($|_)|list_)/.test(type))return yes('UTF-8文字列120バイト、文字列変数16個、数値リスト16個×1000項目まで。共有データをタスク間で保護します。','UTF-8 text up to 120 bytes, 16 text variables and 16 numeric lists of 1000 items; shared access is serialized.');
  if(/^ev3_log_/.test(type))return yes('SDカード直下へ EBL_プログラム名_ログ名.csv を記録します。5000行まで。取り出しはSDカードをPCで読みます。','Writes EBL_program_log.csv to the SD root, up to 5000 rows. Retrieve the card on the PC.');
  if(/^ev3_pid/.test(type))return yes('16種類のPIDに対応。時間単位は秒、初回・60秒超の中断後はP項のみ。出力の範囲制限は自分で指定します。','16 PID states; time in seconds; first/stale samples are P-only. Clamp the output explicitly.');
  if(type==='ev3_data_random')return yes('−32767〜32767の整数範囲に対応。','Integer ranges from -32767 to 32767 are supported.');
  if(/^ev3_ir_(remote|button|beacon_)/.test(type))return yes('リモコン番号・一致判定とビーコン検出・方向・近さに対応。同じ入力ポートの異なるモードを並行実行できません。','Remote codes and beacon detection/heading/distance supported. Do not use different modes concurrently on one input port.');
  if(/^ev3_brick_button/.test(type))return yes('上・中央・下・右・左・いずれかを読み取れます。戻るボタンは全体停止用です。','Reads Up/Enter/Down/Right/Left/Any. Back is reserved for stopping.');
  if(type==='ev3_motor_power')return maybe('Lモーターの未調整出力に対応。Mは公開APIの種類指定の制約で未対応です。「EV3RTの制約・相違点」を確認してください。','Raw L power is supported. Raw M power cannot preserve M type through the public API. See motor limitations.');
  if(type==='ev3_motor_speed_set')return maybe('連続回転・独立有限動作の速度変更に対応。ネイティブ同期中の変更と有限動作中の逆転は停止してから指定してください。','Supports continuous and independent finite speed updates. Stop before changing native synchronized motion or reversing a finite move.');
  if(type==='ev3_motor_speed')return yes('HRP3ドライバーの実測速度を取得します。','Reads measured speed from the HRP3 driver.');
  if(type==='ev3_motor_stop_mode')return yes('ブレーキ・惰性・独自の位置保持に対応。ポートごとの動作後の停止方法を設定します。','Per-port defaults support brake, coast and software position hold.');
  if(type==='ev3_display_number')return yes('小数0〜3桁・通常/大に対応。生成したドット字形のため標準EV3のフォントとは異なります。','0–3 decimals, normal/large; generated dot glyphs differ from the standard EV3 font.');
  if(type==='ev3_led') {
    if(fields.MODE==='pulse')return no('滑らかな明滅は公開APIに明るさ指定がないため未対応です。点灯・点滅を選んでください。','Smooth pulsing is unavailable through the public brightness API. Use steady light or flashing.');
    if(!fields.MODE)return maybe('点灯・点滅に対応。滑らかな明滅は公開APIの制約で未対応です。','Steady light and flashing supported; smooth pulsing is unavailable through the public API.');
    return yes('点灯・ソフトウェア点滅に対応。点滅は250msごとの切替えでプログラム実行中だけ続きます。','Steady light and software flashing every 250ms while the program is alive.');
  }
  if(['ev3_motor_stop','ev3_stop_port'].includes(type))return yes('ブレーキ・惰性・独自の位置保持に対応。保持は20ms周期・最大±20％でプログラム実行中だけ有効です。','Brake, coast and software hold are supported. Hold runs every 20ms, capped at ±20%, while the program is alive.');
  if(type==='ev3_start')return maybe('複数スタート・イベント受信は合計16個まで。タスク間で同じモーターへ駆動指示が競合すると全体を停止します。','Up to 16 starts and event listeners. Conflicting drive commands from different tasks stop the application.');
  if(/^procedures_/.test(type)||/^ev3_(call_outputs|return_values?|myblock_return|argument)$/.test(type))return yes('数値の引数・戻り値に対応。再帰不可などのEBL共通仕様は同じです。','Numeric arguments and results are supported, with the same common EBL rules such as no recursion.');
  if(type==='ev3_ramp')return yes('L/Mの単独・2個の角度・回転数・時間指定と「動き」で台形・S字に対応。連続回転は対象外です。','Trapezoid/S-curve profiles support finite L/M single/pair and Movement blocks. Continuous running is not profiled.');
  if(/^ev3_motor_.*(angle|rotation|time)$/.test(type)||['ev3_motor','ev3_motor_m'].includes(type))return yes('L・M、台形・S字加減速、独立制御・停止タイミング補正に対応。2個の角度・回転数はネイティブ同期も選べます。','L/M, trapezoid/S-curve profiles, independent control and completion feedback are supported. Paired angle/rotations also offer native synchronization.');
  if(/^ev3_(steering_|tank($|_)|spin_|pivot_|drive_)/.test(type))return yes('台形・S字に対応。通常の入力条件として、先に左右モーターを設定し、距離・旋回ではタイヤ直径・トレッドも設定します。','Profiles supported. Set movement ports and the required wheel diameter/track dimensions before distance and turn commands.');
  if(/^ev3_motor_[lm]_(single_|pair_)?run$/.test(type))return yes('L・Mモーターに対応。回し始めたら次の命令へ進みます。','L/M supported. Execution continues after starting the motor.');
  if(/^(math_number|math_change|variables_get|variables_set|logic_compare|logic_operation|logic_negate|logic_boolean|controls_if|controls_repeat_ext|controls_whileUntil)$/.test(type))return yes();
  if(/^ev3_(op_[a-z]+|data_(mod|min|max|clamp|round)|math|math_function|battery_(voltage|current)|timer(_reset)?|encoder(_reset)?|gyro_(angle|rate|compare|reset)|touch(_value)?|ir_(proximity|compare)|color_(is|value)|reflected(_compare)?|distance(_compare)?|wait(_seconds|_until)?|forever|program_end|tone|led_off|display_(clear|text|image)|movement_(setup|stop)|wheel|tread|stop)$/.test(type))return yes();
  return {status:'unsupported',known:false,ja:'このブロックのEV3-RT対応は未確認です。',en:'EV3-RT support for this block has not been verified.'};
}

export function installSupportUI({Blockly,workspace,toolbox,checkProgram,download,version=''}) {
  const $=id=>document.getElementById(id),english=()=>globalThis.EBLi18n?.language==='en';
  const tr=(ja,en)=>english()?en:ja;
  const label=s=>({supported:tr('✓ 対応','✓ Supported'),conditional:tr('△ 条件付き','△ Conditional'),unsupported:tr('× 未対応','× Unsupported')})[s];
  const describe=b=>{const fields=Object.fromEntries(b.inputList.flatMap(i=>i.fieldRow.filter(f=>f.name).map(f=>[f.name,f.getValue()])));return blockSupport(b.type,fields);};
  const line=b=>{const s=describe(b);return 'EV3-RT '+label(s.status)+'：'+(english()?s.en:s.ja);};
  const dialog=document.createElement('dialog');dialog.id='ev3rtSupportDialog';dialog.className='rt-support-dialog';dialog.setAttribute('aria-labelledby','rtSupportTitle');
  document.body.append(dialog);
  const button=document.createElement('button');button.id='ev3rtSupportButton';button.type='button';document.querySelector('.teacher-extra').append(button);
  const status=document.createElement('div');status.id='ev3rtBlockSupport';status.className='rt-block-support';status.setAttribute('role','status');document.querySelector('.editor-toolbar').after(status);
  // These elements have their own language rendering; avoid partial automatic translations.
  for(const e of [dialog,button,status])e.setAttribute('data-user-content','');
  const categories=new Map();
  for(const c of toolbox.contents)for(const entry of c.contents??[])if(entry.type)categories.set(entry.type,c.name);
  const types=[...new Set([...categories.keys(),...Object.keys(Blockly.Blocks).filter(t=>t.startsWith('ev3_')), 'variables_get','variables_set','math_change','procedures_defnoreturn','procedures_defreturn','procedures_callnoreturn','procedures_callreturn'])];
  let rows=[],selected=null;
  const originals=new WeakMap();
  function annotate() {
    button.textContent=tr('EV3-RT対応表','EV3-RT support');
    const flyout=workspace.getFlyout()?.getWorkspace();
    for(const b of [...workspace.getAllBlocks(false),...(flyout?.getAllBlocks(false)??[])]){
      if(!originals.has(b)){const tip=b.tooltip;originals.set(b,tip);b.setTooltip(()=>{const original=originals.get(b);return (typeof original==='function'?original.call(b):typeof original==='string'?original:'')+'\n\n'+line(b);});}
    }
    status.textContent=selected&&!selected.isDisposed()?line(selected):tr('EV3-RT：ブロックを選ぶと対応状況を表示します。全体は「EV3-RT対応表」で確認できます。','EV3-RT: Select a block to see its support. Open the support table for all blocks.');
    status.dataset.status=selected&&!selected.isDisposed()?describe(selected).status:'';
  }
  function makeRows(){
    const scratch=new Blockly.Workspace();
    const names={variables_get:['変数の値','Variable value'],variables_set:['変数に値を設定','Set variable'],math_change:['変数を増やす','Change variable'],ev3_argument:['マイブロックの引数','My Block argument'],ev3_call_outputs:['マイブロックを呼び出し、戻り値を変数へ','Call My Block and store results'],procedures_defnoreturn:['マイブロックを定義（戻り値なし）','Define My Block (no result)'],procedures_defreturn:['マイブロックを定義（戻り値あり）','Define My Block (with result)'],procedures_callnoreturn:['マイブロックを呼び出す（戻り値なし）','Call My Block (no result)'],procedures_callreturn:['マイブロックを呼び出す（戻り値あり）','Call My Block (with result)']};
    Blockly.Events.disable();
    try {rows=types.map(type=>{let name=type;try{const b=scratch.newBlock(type);name=b.toString(160);b.dispose(false);}catch{}if(names[type])name=tr(...names[type]);return {type,name,category:categories.has(type)?(globalThis.EBLi18n?.t(categories.get(type))??categories.get(type)):tr('変数・マイブロック・互換ブロック','Variables / My Blocks / legacy'),...blockSupport(type)};});}
    finally{scratch.dispose();Blockly.Events.enable();}
    rows=rows.flatMap(r=>r.type==='ev3_led'?['on','flash','pulse'].map(mode=>({...r,name:tr('本体ランプ：'+({on:'点灯',flash:'点滅',pulse:'明滅'}[mode]),'Brick LED: '+mode),...blockSupport(r.type,{MODE:mode})})):r);
    const raw=rows.find(r=>r.type==='ev3_motor_power');if(raw)rows.push({...raw,name:tr('未調整パワー（Mモーター選択時）','Raw power (M motor selected)'),...no('Mの種類を維持した未調整出力は公開APIで指定できません。速さ指定を使ってください。','The public API cannot preserve M type in unregulated mode. Use regulated speed.')});
  }
  function render(){
    const search=$('rtSupportSearch').value.toLowerCase(),filter=$('rtSupportFilter').value,category=$('rtSupportCategory').value;
    const visible=rows.filter(r=>(!filter||r.status===filter)&&(!category||r.category===category)&&[r.name,r.type,r.ja,r.en].join(' ').toLowerCase().includes(search));
    $('rtSupportCount').textContent=tr(`${visible.length} / ${rows.length} 項目（設定別を含む）`,`${visible.length} / ${rows.length} entries (including settings)`);
    const body=$('rtSupportBody');body.replaceChildren();
    for(const r of visible){const row=document.createElement('tr');for(const [value,cls] of [[r.category,''],[r.name,''],[label(r.status),'rt-support-'+r.status],[english()?r.en:r.ja,'']]){const td=document.createElement('td');td.textContent=value;if(cls)td.className=cls;row.append(td);}body.append(row);}
  }
  function open(){
    makeRows();dialog.replaceChildren();
    const element=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
    const title=element('h2',tr('EV3-RT ブロック対応表','EV3-RT block support'));title.id='rtSupportTitle';dialog.append(title);
    dialog.append(element('p',tr('✓ 対応　△ 条件付き　× 未対応。現在のCソース出力機能の対応状況です。実機での精度・動作を保証する表示ではありません。','✓ Supported　△ Conditional　× Unsupported. This describes the current C exporter, not hardware validation.')));
    dialog.append(element('p',tr('ブロックにマウスを重ねるか、編集画面で選択すると説明が表示されます。通常の.rbf出力とは対応範囲が異なります。','Hover over or select a block for details. Standard .rbf output has different support.')));
    const requirements=document.createElement('details');requirements.className='rt-requirements';requirements.append(element('summary',tr('必須要件（環境・準備）','Prerequisites (environment / setup)')));
    const reqList=document.createElement('ul');for(const r of EV3RT_REQUIREMENTS)reqList.append(element('li',english()?r.en:r.ja));requirements.append(reqList);
    const setup=element('a',tr('環境設定・初回準備をブラウザーで読む','Open environment setup guide'));setup.href='ev3rt-setup.html';setup.target='_blank';setup.rel='noopener';requirements.append(setup);dialog.append(requirements);
    const downloads=document.createElement('div');downloads.className='rt-support-downloads';
    for(const [format,ja,en]of [['html','対応表を保存（HTML）','Save support table (HTML)'],['csv','CSV形式で保存','Save as CSV']]){const save=element('button',tr(ja,en));save.type='button';save.id='rtSupportDownload'+format.toUpperCase();save.onclick=()=>{const file=supportDownloads(rows,{english:english(),version})[format];download(file.data,file.name,file.type);};downloads.append(save);}dialog.append(downloads);
    dialog.append(element('p',tr('全項目・制約・必須要件を分けて保存します（検索・絞り込みに関係なく）。HTMLはブラウザーで読め、印刷・PDF保存もできます。','Downloads include block support, limitations and prerequisites as separate sections, regardless of filters. Open HTML to read, print or save a PDF.')));
    const limits=document.createElement('details');limits.className='rt-motor-limits';limits.append(element('summary',tr('動作上の制約・相違点（全グループ）','Behavioral limitations and differences (all groups)')));
    const list=document.createElement('ul');for(const item of [...OTHER_LIMITATIONS,...MOTOR_LIMITATIONS]){const tag={unsupported:tr('公開APIで未対応','Unavailable through public API'),constraint:tr('組合せの制約','Combination constraint'),difference:tr('動作・運用の相違','Behavior / workflow difference'),implementation:tr('現在の実装上の制限','Current implementation limit')}[item.kind];list.append(element('li','【'+tag+'】'+item.id+'：'+(english()?item.en:item.ja)));}limits.append(list);dialog.append(limits);
    const filters=document.createElement('div');filters.className='rt-support-filters';
    const input=document.createElement('input');input.id='rtSupportSearch';input.placeholder=tr('ブロック名・機能を検索','Search blocks or features');input.setAttribute('aria-label',input.placeholder);filters.append(input);
    const select=document.createElement('select');select.id='rtSupportFilter';select.setAttribute('aria-label',tr('対応状況','Support status'));
    for(const [v,t] of [['',tr('すべての対応状況','All statuses')],...['supported','conditional','unsupported'].map(s=>[s,label(s)])]){const o=element('option',t);o.value=v;select.append(o);}filters.append(select);
    const cats=document.createElement('select');cats.id='rtSupportCategory';cats.setAttribute('aria-label',tr('カテゴリ','Category'));for(const c of ['',...new Set(rows.map(r=>r.category))]){const o=element('option',c||tr('すべてのカテゴリ','All categories'));o.value=c;cats.append(o);}filters.append(cats);dialog.append(filters);
    for(const e of [input,select,cats])e.addEventListener('input',render);
    const count=element('p','');count.id='rtSupportCount';count.setAttribute('aria-live','polite');dialog.append(count);
    const scroll=document.createElement('div');scroll.className='rt-support-scroll';const table=document.createElement('table');const head=document.createElement('thead'),hr=document.createElement('tr');for(const t of [tr('カテゴリ','Category'),tr('ブロック','Block'),tr('対応','Support'),tr('条件・説明','Conditions / details')]){const th=element('th',t);th.scope='col';hr.append(th);}head.append(hr);table.append(head);const body=document.createElement('tbody');body.id='rtSupportBody';table.append(body);scroll.append(table);dialog.append(scroll);
    const output=element('p',tr('作品の確認では、接続されたブロックとマイブロックをCソースに変換して検証します。コンパイル・転送・実行は行いません。','Check the connected program and My Blocks with the C exporter. This does not compile, transfer or run it.'));output.id='rtSupportResult';output.setAttribute('role','status');dialog.append(output);
    const actions=document.createElement('div');actions.className='myblock-actions';const close=element('button',tr('閉じる','Close'));close.onclick=()=>dialog.close();const check=element('button',tr('この作品のEV3-RT対応を確認','Check this program'));check.className='primary';check.onclick=()=>{try{checkProgram();output.textContent=tr('✓ この作品のCソースを生成できます。コンパイルと実機確認は別途必要です。','✓ C source can be generated. Compilation and hardware checks are still required.');output.className='rt-support-supported';}catch(e){output.textContent='× '+e.message;output.className='rt-support-unsupported';}};actions.append(close,check);dialog.append(actions);render();dialog.showModal();
  }
  button.onclick=open;
  let pending;workspace.addChangeListener(event=>{if(event.type===Blockly.Events.SELECTED)selected=event.newElementId?workspace.getBlockById(event.newElementId):null;clearTimeout(pending);pending=setTimeout(annotate,100);});
  $('uiLanguage')?.addEventListener('change',()=>setTimeout(annotate,200));
  annotate();
}
