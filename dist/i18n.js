// 表示だけを翻訳する。ブロックの型・フィールドID・利用者が付けた名前は変更しない。
export const LANGUAGE_KEY='ev3-block-lab-language';
export function preferredLanguage(storage,search=''){
 const requested=new URLSearchParams(search).get('lang');
 if(['ja','en'].includes(requested))return requested;
 try{return storage.getItem(LANGUAGE_KEY)==='en'?'en':'ja';}catch{return 'ja';}
}
export function makeTranslator(dictionary,language){
 const entries=Object.entries(dictionary).filter(([key])=>key).sort((a,b)=>b[0].length-a[0].length);
 return text=>{
  if(language()!=='en'||typeof text!=='string')return text;
  if(Object.hasOwn(dictionary,text))return dictionary[text];
  const trimmed=text.trim();if(Object.hasOwn(dictionary,trimmed))return text.replace(trimmed,dictionary[trimmed]);
  const range=text.match(/^(.+)は ([−\-\d.]+)〜([−\-\d.]+) の整数にしてください。$/);
  if(range){let label=range[1];for(const [from,to]of entries)label=label.split(from).join(to);return `${label}: use an integer from ${range[2]} to ${range[3]}.`;}
  text=text.replace(/(\d+) バイト \/ マイブロック (\d+) 個/g,'$1 bytes / $2 My Blocks');
  // 動的な数値・ファイル名を残し、案内文に含まれる既知の文・用語を翻訳する。
  let result=text;
  for(const [from,to]of entries)if(from.length>1&&result.includes(from))result=result.split(from).join(to);
  return result;
 };
}
export function installI18n({Blockly,jaMessages,enMessages,catalog,document,storage,search=''}){
 let language=preferredLanguage(storage,search),adapter=null;
 const t=makeTranslator(catalog.text,()=>language);
 const translateToolbox=value=>Array.isArray(value)?value.map(translateToolbox):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>{
  // 定義名を含む編集ボタンも、名前の中身は訳さない。
  if(key==='text'&&value.callbackKey?.startsWith('EV3_EDIT_'))return [key,language==='en'?'Edit “'+item.replace(/^「|」を編集$/g,'')+'”':item];
  return [key,(key==='name'&&value.kind==='category'||key==='text'&&['label','button'].includes(value.kind))?t(item):key==='contents'?translateToolbox(item):item];
 })):value;
 const overrides={PROCEDURES_DEFNORETURN_PROCEDURE:'マイブロック',PROCEDURES_DEFNORETURN_TITLE:'定義',PROCEDURES_DEFRETURN_TITLE:'定義',PROCEDURES_DEFRETURN_RETURN:'返す値',CONTROLS_IF_MSG_THEN:'',CONTROLS_IF_MSG_ELSE:'',CONTROLS_IF_MSG_ELSEIF:'でなければ、もし',CONTROLS_REPEAT_INPUT_DO:'',PROCEDURES_CALLNORETURN_TOOLTIP:'マイブロックを呼び出します。',DUPLICATE_BLOCK:'複製'};
 function messages(){Blockly.setLocale(language==='en'?enMessages:jaMessages);for(const [key,value]of Object.entries(overrides))Blockly.Msg[key]=t(value);}
 const jsonInit=Blockly.Block.prototype.jsonInit;
 Blockly.Block.prototype.jsonInit=function(source){
  const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
  const data=clone(source),labels=catalog.blocks[data.type??this.type];
  for(const key of Object.keys(data)){
   if(/^message\d+$/.test(key))data[key]=language==='en'?(labels?.[Number(key.slice(7))]??t(data[key])):data[key];
   if(/^args\d+$/.test(key))for(const field of data[key]){
    if(field.type==='field_dropdown'&&Array.isArray(field.options))field.options=field.options.map(([label,value])=>[typeof label==='string'?t(label):label,value]);
    if(field.type==='field_label')field.text=t(field.text);
   }
  }
  if(language==='en'&&data.tooltip)data.tooltip=catalog.tips[data.type??this.type]??t(data.tooltip);
  return jsonInit.call(this,data);
 };
 const append=Blockly.Input.prototype.appendField;
 Blockly.Input.prototype.appendField=function(field,name){
  // ARGNAME/RETURN_LABELなどは利用者が付けた引数・戻り値の名前。
  if(typeof field==='string'&&(!name||!(/^(ARGNAME|RETURN_LABEL|OUT_LABEL|LABEL)\d*$/.test(name)||name==='NAME')))field=t(field);
  return append.call(this,field,name);
 };
 const tooltip=Blockly.Block.prototype.setTooltip;
 Blockly.Block.prototype.setTooltip=function(value){return tooltip.call(this,typeof value==='function'?()=>t(value()):t(value));};
 const originals=new WeakMap(),attributes=new WeakMap(),guideLinks=new WeakMap();
 const skip=node=>node.parentElement?.closest('script,style,svg,pre,input,textarea,.blocklyDropDownDiv,.blocklyWidgetDiv,[data-user-content],[data-language]');
 function localize(root=document.body){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){
   if(skip(node))continue;
   const old=originals.get(node),source=old&&node.data===old.rendered?old.source:node.data,rendered=t(source);
   originals.set(node,{source,rendered});if(node.data!==rendered)node.data=rendered;
  }
  for(const element of root.querySelectorAll('[title],[placeholder],[aria-label]')){
   if(element.closest('svg,.blocklyDropDownDiv,.blocklyWidgetDiv'))continue;
   let saved=attributes.get(element);if(!saved){saved=new Map();attributes.set(element,saved);}
   for(const name of ['title','placeholder','aria-label'])if(element.hasAttribute(name)){
    if(element.id==='manualDownload'&&name==='title')continue;
    const current=element.getAttribute(name),old=saved.get(name),source=old&&current===old.rendered?old.source:current,rendered=t(source);
    saved.set(name,{source,rendered});if(current!==rendered)element.setAttribute(name,rendered);
   }
  }
  document.documentElement.lang=language;
  for(const section of document.querySelectorAll('[data-language]'))section.hidden=section.dataset.language!==language;
  const select=document.getElementById('uiLanguage');if(select)select.value=language;
  const pdf=document.getElementById('manualDownload'),html=document.getElementById('manualHtml');
  if(pdf){const stem=language==='en'?'EV3-Block-Lab-Manual-v0.25.5-en':'EV3-Block-Lab-ブロック命令マニュアル-v0.25.5';pdf.href='manual/'+stem+'.pdf';pdf.download=stem+'.pdf';}
  if(pdf){const title=language==='en'?'Manual v0.25.5 · 20 chapters · 23 pages':'最新版マニュアル v0.25.5・全20章・42ページ';if(pdf.title!==title)pdf.title=title;}
  if(html)html.href='manual/'+(language==='en'?'EV3-Block-Lab-Manual-v0.25.5-en':'EV3-Block-Lab-ブロック命令マニュアル-v0.25.5')+'.html';
  const guideChapters={'v019-guide.html':5,'v018-guide.html':4,'v017-guide.html':13,'pid-battery-guide.html':10,'gyro-guide.html':7,'display-guide.html':11};
  for(const link of document.querySelectorAll('a[href]')){
   const source=guideLinks.get(link)??link.getAttribute('href');
   if(!guideChapters[source])continue;guideLinks.set(link,source);
   const target=language==='en'?'manual/EV3-Block-Lab-Manual-v0.25.5-en.html#chapter-'+guideChapters[source]:source;
   if(link.getAttribute('href')!==target)link.setAttribute('href',target);
  }
 }
 function apply(next){if(!['ja','en'].includes(next))throw Error('Unsupported language');language=next;messages();localize();}
 const observer=new MutationObserver(records=>{if(records.some(record=>!((record.target.nodeType===3?record.target.parentElement:record.target)?.closest?.('svg,.blocklyDropDownDiv,.blocklyWidgetDiv'))))localize();});
 // 文字と案内用属性のみ監視する。hrefやlangの更新で監視をループさせない。
 observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label']});
 messages();localize();
 return {t,toolbox:translateToolbox,get language(){return language;},apply,localize,
  attach(value){adapter=value;const select=document.getElementById('uiLanguage');select.disabled=false;select.onchange=()=>{
   const next=select.value,previous=language;if(next===previous)return;
   try{adapter.switchLanguage(next);try{storage.setItem(LANGUAGE_KEY,next);}catch{}localize();}
   catch(error){apply(previous);select.value=previous;adapter.showError(t(error.message));}
  };messages();localize();}
 };
}
