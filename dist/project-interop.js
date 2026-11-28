// Shared SBL / EBL editing-file conversion. No device code or file-system writes.
export const UNCONVERTED = 'blocklab_unconverted';
export const FORMATS = {sbl:'spike-block-lab',ebl:'ev3-block-lab'};
const rows = [
 ['spike_start','ev3_start'],['lab_wait','ev3_wait_seconds'],['lab_wait_until','ev3_wait_until'],
 ['lab_forever','ev3_forever'],['lab_end','ev3_program_end'],['lab_return','ev3_myblock_return'],
 ['lab_when','ev3_when_condition'],['lab_when_changed','ev3_when_changed'],['lab_message_hat','ev3_when_message'],
 ['lab_broadcast','ev3_message_send'],['lab_message_wait','ev3_message_wait'],['lab_sound_tone','ev3_tone'],
 ['lab_pid','ev3_pid'],['lab_pid_reset','ev3_pid_reset'],['lab_timer','ev3_timer'],['lab_timer_reset','ev3_timer_reset'],
 ['lab_argument','ev3_argument'],['lab_call_outputs','ev3_call_outputs'],['lab_return_values','ev3_return_values'],['lab_return_value','ev3_return_value'],
 ['lab_log_start','ev3_log_start',{NAME:'FILE'}],['lab_log_value','ev3_log_value'],['lab_log_end','ev3_log_end'],
 ['lab_text_get','ev3_text_get'],['lab_text_set','ev3_text_set'],['lab_string_literal','ev3_text'],
 ['lab_string_join','ev3_text_join'],['lab_string_length','ev3_text_length'],['lab_string_letter','ev3_text_letter'],
 ['lab_string_includes','ev3_text_contains'],['lab_string_equals','ev3_text_equal'],
 ['lab_string_number','ev3_text_number'],['lab_string_parse','ev3_text_to_number'],
 ...['add','sub','mul','div','lt','eq','gt','lte','gte','neq','and','or'].map(x=>['lab_op_'+x,'ev3_op_'+x]),
 ['lab_math_function','ev3_math_function'],
 ...['mod','random','min','max','round','clamp'].map(x=>['lab_data_'+x,'ev3_data_'+x]),
 ...['clear','add','set','delete','item','length','contains','stat'].map(x=>['lab_list_'+x,'ev3_list_'+x,{NAME:'LIST'}])
];
const identical=new Set(['math_number','logic_compare','logic_operation','logic_negate','logic_boolean',
 'controls_if','controls_repeat_ext','controls_whileUntil','variables_get','variables_set','math_change',
 'procedures_defnoreturn','procedures_callnoreturn','procedures_defreturn','procedures_callreturn']);
const clone=x=>structuredClone(x);
const invert=x=>Object.fromEntries(Object.entries(x??{}).map(([a,b])=>[b,a]));
const rename=(obj,map)=>Object.fromEntries(Object.entries(obj??{}).map(([k,v])=>[map?.[k]??k,v]));
export function isForeignProject(data,target){return data?.format===FORMATS[target==='sbl'?'ebl':'sbl'];}
function validateEnvelope(data){
 if(!Object.values(FORMATS).includes(data?.format)||data.version!==1||!Array.isArray(data.workspace?.blocks?.blocks))throw Error('SBLまたはEBLの「保存」で作った作品を選んでください。');
 let count=0;
 const visit=(value,depth=0)=>{if(depth>180)throw Error('作品の入れ子が深すぎます。');if(!value||typeof value!=='object')return;if(typeof value.type==='string'&&++count>2000)throw Error('作品のブロックが多すぎます。');for(const v of Object.values(value))visit(v,depth+1);};
 visit(data.workspace);
}
export function convertProject(data,target,sourceFilename=''){
 validateEnvelope(data);if(!isForeignProject(data,target))throw Error('変換元と変換先を確認してください。');
 const toSbl=target==='sbl',sourceFormat=data.format,unsupported=[],sourceCopy=clone(data);
 const mappings=new Map(rows.map(([s,e,f])=>toSbl?[e,{type:s,fields:invert(f)}]:[s,{type:e,fields:f}]));
 let converted=0;
 function convert(raw,role='statement'){
  if(!raw||typeof raw!=='object'||typeof raw.type!=='string')throw Error('ブロックの保存形式を確認してください。');
  if(raw.type===UNCONVERTED&&raw.extraState?.sourceFormat===FORMATS[target]){
   const restored=clone(raw.extraState.original);if(raw.next)restored.next={block:convert(raw.next.block)};converted++;return restored;
  }
  let b=clone(raw),m=mappings.get(b.type),inputMap={};
  if(identical.has(b.type))m={type:b.type};
  if(toSbl&&b.type==='ev3_math') {m={type:'lab_op_'+b.fields?.OP};if(!['add','sub','mul','div'].includes(b.fields?.OP))m=null;delete b.fields?.OP;}
  if(!toSbl){
   if(b.type==='text')m={type:'ev3_text'};
   if(b.type==='math_arithmetic') {const op={ADD:'add',MINUS:'sub',MULTIPLY:'mul',DIVIDE:'div'}[b.fields?.OP];m=op?{type:'ev3_op_'+op}:null;if(m)delete b.fields.OP;}
   if(['math_single','math_trig'].includes(b.type)) {const fn={ABS:'abs',ROOT:'sqrt',LN:'ln',LOG10:'log',EXP:'exp',POW10:'pow10',SIN:'sin',COS:'cos',TAN:'tan',ASIN:'asin',ACOS:'acos',ATAN:'atan'}[b.fields?.OP];m=fn?{type:'ev3_math_function'}:null;if(m){b.fields={FUNCTION:fn};inputMap={NUM:'VALUE'};}}
   if(b.type==='math_round'){const op=b.fields?.OP;m=op==='ROUND'?{type:'ev3_data_round'}:['ROUNDUP','ROUNDDOWN'].includes(op)?{type:'ev3_math_function'}:null;if(m){b.fields=op==='ROUND'?{}:{FUNCTION:op==='ROUNDUP'?'ceil':'floor'};inputMap={NUM:op==='ROUND'?'A':'VALUE'};}}
   if(b.type==='math_modulo'){m={type:'ev3_data_mod'};inputMap={DIVIDEND:'A',DIVISOR:'B'};}
   if(b.type==='math_random_int'){m={type:'ev3_data_random'};inputMap={FROM:'A',TO:'B'};}
   if(b.type==='math_constrain'){m={type:'ev3_data_clamp'};inputMap={VALUE:'A'};}
   if(b.type==='lab_minmax'&&['min','max'].includes(b.fields?.OP)){m={type:'ev3_data_'+b.fields.OP};delete b.fields.OP;}
   if(b.type==='text_length')m={type:'ev3_text_length'};
   if(b.type==='text_charAt'&&b.fields?.WHERE==='FROM_START'){m={type:'ev3_text_letter'};inputMap={AT:'INDEX'};delete b.fields.WHERE;}
   if(b.type==='text_join'){
    const count=b.extraState?.itemCount??2;
    if(Number.isInteger(count)&&count>=0&&count<=64){
     const text=()=>({type:'ev3_text',fields:{TEXT:''}});
     let joined=text();
     for(let i=0;i<count;i++)joined={type:'ev3_text_join',inputs:{A:{block:joined},B:b.inputs?.['ADD'+i]??{shadow:{type:'text',fields:{TEXT:''}}}}};
     // Convert only newly composed join nodes; each source operand is visited once.
     const compose=(node)=>node.type==='ev3_text_join'?{...node,inputs:{A:{block:compose(node.inputs.A.block)},B:Object.fromEntries(Object.entries(node.inputs.B).map(([k,v])=>[k,convert(v,'value')]))}}:node;
     const result=compose(joined);Object.assign(result,Object.fromEntries(['id','x','y','disabledReasons','collapsed','data'].filter(k=>k in b).map(k=>[k,b[k]])));converted++;return result;
    }
   }
   const aliases={lab_string_char:['ev3_text_letter',{TEXT:'VALUE'}],lab_string_contains:['ev3_text_contains',{TEXT:'A',FIND:'B'}],lab_string_equal:['ev3_text_equal',{TEXT:'A',OTHER:'B'}],lab_string_to_number:['ev3_text_to_number',{TEXT:'VALUE'}],lab_string_from_number:['ev3_text_number',{}]};
   if(aliases[b.type]){m={type:aliases[b.type][0]};inputMap=aliases[b.type][1];}
  }
  if(!m){
   const original=clone(raw);delete original.next;
   unsupported.push({type:raw.type,id:raw.id??'',role});
   return {type:UNCONVERTED,...(raw.id?{id:raw.id}:{}),...(raw.x!==undefined?{x:raw.x,y:raw.y}:{}),
    extraState:{sourceFormat,original,role},...(raw.next?{next:{block:convert(raw.next.block)}}:{})};
  }
  converted++;b.type=m.type;
  if(b.fields)b.fields=rename(b.fields,m.fields);
  if(b.inputs)b.inputs=Object.fromEntries(Object.entries(b.inputs).map(([key,value])=>{
   const slot=inputMap[key]??key,childRole=/^(DO\d*|STACK|ELSE|BODY)$/.test(slot)?'statement':/^(BOOL|IF\d+)$/.test(slot)?'boolean':'value';
   return [slot,Object.fromEntries(Object.entries(value).map(([kind,child])=>[kind,['block','shadow'].includes(kind)?convert(child,childRole):clone(child)]))];
  }));
  if(b.next)b.next={block:convert(b.next.block)};
  return b;
 }
 const workspace=clone(data.workspace);workspace.blocks.blocks=workspace.blocks.blocks.map(b=>convert(b));
 const name=String(data.programName??data.name??'MyProgram');
 const convertedName=toSbl?(name.slice(0,76)+'_SBL'):(name.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,27)||'Program')+'_EBL';
 const importedFrom={filename:sourceFilename||name+(toSbl?'.ev3lab':'.spikelab'),original:sourceCopy};
 const project={format:FORMATS[target],version:1,name:convertedName,workspace,importedFrom,
  ...(toSbl?{language:'standard'}:{programName:convertedName,ev3ProjectName:'Imported',pairMode:'independent'})};
 return {project,converted,unsupported,sourceFormat,sourceFilename:importedFrom.filename};
}
export function installInteropBlocks(Blockly){
 Blockly.Blocks[UNCONVERTED]={
  init(){this.appendDummyInput().appendField('要確認：変換できないブロック','IMPORT_LABEL');this.setColour('#bd3038');this.setTooltip('元のブロックと中の内容を保持しています。使う機種のブロックに置き換えてください。残っている間は転送できません。');this.setPreviousStatement(true);this.setNextStatement(true);},
  saveExtraState(){return clone(this.importState_);},
  loadExtraState(state){
   if(!Object.values(FORMATS).includes(state?.sourceFormat)||typeof state.original?.type!=='string'||!['statement','value','boolean'].includes(state.role))throw Error('要確認ブロックの保存内容が不正です。');
   this.importState_=clone(state);this.setNextStatement(state.role==='statement');this.setPreviousStatement(state.role==='statement');
   if(state.role!=='statement')this.setOutput(true,state.role==='boolean'?'Boolean':null);
   this.setFieldValue('要確認：'+state.original.type,'IMPORT_LABEL');
  }
 };
}
export function assertConverted(workspace){
 const blocks=workspace.getAllBlocks(false).filter(b=>b.type===UNCONVERTED);
 if(blocks.length){const e=Error(`変換できないブロックが${blocks.length}個あります。赤い「要確認」を使う機種のブロックに置き換えてください。元の作品は「教員・指導者用」から保存できます。`);e.blockId=blocks[0].id;throw e;}
}
// A review is required before replacing the workspace. The source is downloadable
// both here and later, even after a converted project is saved and reopened.
export function installInteropUI({document,target,download,getProject}){
 const dialog=document.createElement('dialog');dialog.id='projectInteropDialog';dialog.setAttribute('aria-labelledby','interopTitle');
 const title=document.createElement('h2');title.id='interopTitle';title.textContent='別の機種の作品を開く';
 const summary=document.createElement('p'),list=document.createElement('ul'),note=document.createElement('p'),actions=document.createElement('div');
 actions.className='myblock-actions';note.textContent='モーター・センサー・本体表示などは自動変換しません。「要確認」に元の内容を残し、残っている間は転送を止めます。元ファイルは変更せず、変換後は別の名前で保存します。記録の上限・PID周期・音などの動作は機種ごとに異なるため確認してください。';
 const original=document.createElement('button'),cancel=document.createElement('button'),accept=document.createElement('button');
 original.textContent='元の作品を保存';cancel.textContent='キャンセル';accept.textContent='変換して開く';accept.className='primary';actions.append(original,cancel,accept);dialog.append(title,summary,list,note,actions);document.body.append(dialog);
 let pending=null;
 const exportOriginal=(entry=getProject().importedFrom)=>{if(!entry?.original)return;const ext=entry.original.format===FORMATS.sbl?'.spikelab':'.ev3lab';const name=String(entry.filename??'Original').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.(?:spikelab|ev3lab|json)$/i,'')+ext;download(JSON.stringify(entry.original,null,2),name,'application/json');};
 original.onclick=()=>exportOriginal(pending?.project.importedFrom);
 const recovery=document.createElement('button');recovery.id='saveOriginalProject';recovery.textContent='変換前の作品を保存';recovery.hidden=true;recovery.onclick=()=>exportOriginal();
 const menu=document.getElementById('fileMenu');(menu.querySelector('.menu-group')??menu).append(recovery);
 const update=()=>{recovery.hidden=!getProject().importedFrom?.original;};
 return {update,review(report){
  pending=report;summary.textContent=`${target==='sbl'?'EBL → SBL':'SBL → EBL'}：共通ブロック ${report.converted}個、要確認 ${report.unsupported.length}個。`;
  list.replaceChildren();for(const [type,count] of Object.entries(report.unsupported.reduce((m,b)=>(m[b.type]=(m[b.type]??0)+1,m),{}))){const li=document.createElement('li');li.textContent=`${type}：${count}個（中のブロックも保持）`;list.append(li);}
  dialog.showModal();return new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;dialog.close();pending=null;resolve(value);};cancel.onclick=()=>finish(false);accept.onclick=()=>finish(true);dialog.oncancel=e=>{e.preventDefault();finish(false);};});
 }};
}
