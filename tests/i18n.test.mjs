import vm from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installI18n,makeTranslator,preferredLanguage,LANGUAGE_KEY} from '../dist/i18n.js';
import {catalog} from '../dist/locale-en.js';
import {DISPLAY_IMAGES,presetBitmap} from '../dist/display.js';
import {compile} from '../dist/ev3.js';

const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
class XmlNode{
 constructor(name,type=1,text=''){this.nodeName=name;this.nodeType=type;this.data=text;this.childNodes=[];this.attrs=new Map();this.parentNode=null;}
 setAttribute(name,value){this.attrs.set(name,String(value));}getAttribute(name){return this.attrs.get(name)??null;}removeAttribute(name){this.attrs.delete(name);}
 hasAttributes(){return !!this.attrs.size;}hasChildNodes(){return !!this.childNodes.length;}
 appendChild(child){this.childNodes.push(child);child.parentNode=this;return child;}
 get firstChild(){return this.childNodes[0]??null;}get nextSibling(){const siblings=this.parentNode?.childNodes??[];return siblings[siblings.indexOf(this)+1]??null;}
 get textContent(){return this.nodeType===3?this.data:this.childNodes.map(x=>x.textContent).join('');}
 set textContent(value){if(this.nodeType===3)this.data=String(value);else{this.childNodes=[];this.appendChild(new XmlNode('#text',3,String(value)));}}
 cloneNode(deep){const node=new XmlNode(this.nodeName,this.nodeType,this.data);node.attrs=new Map(this.attrs);if(deep)for(const child of this.childNodes)node.appendChild(child.cloneNode(true));return node;}
}

function editor(){
 const select={value:'ja'},doc={body:{querySelectorAll:()=>[]},documentElement:{},querySelectorAll:()=>[],getElementById:id=>id==='uiLanguage'?select:null,createTreeWalker:()=>({nextNode:()=>null})};
 globalThis.NodeFilter={SHOW_TEXT:4};globalThis.MutationObserver=class{observe(){}};
 const c=vm.createContext({console,setTimeout,clearTimeout,DISPLAY_IMAGES,presetBitmap,XMLSerializer:class{serializeToString(n){return "<"+n.nodeName+">"+n.childNodes.map(c=>this.serializeToString(c)).join("")+"</"+n.nodeName+">";}},document:{createElementNS:(_ns,name)=>new XmlNode(name),createTextNode:text=>new XmlNode("#text",3,text),querySelector:()=>({}),getElementById:()=>({value:'independent'})}});
 for(const f of ['blockly_compressed.js','blocks_compressed.js','ja.js'])vm.runInContext(readFileSync(new URL('../dist/vendor/'+f,import.meta.url),'utf8'),c);
 const ja={...c.Blockly.Msg};vm.runInContext(readFileSync(new URL('../dist/vendor/en.js',import.meta.url),'utf8'),c);
 c.EBLi18n=installI18n({Blockly:c.Blockly,jaMessages:ja,enMessages:{...c.Blockly.Msg},catalog,document:doc,storage:{getItem:()=> 'ja'},search:''});
 c.languageSelect=select;
 vm.runInContext(app.slice(app.indexOf('\n')+1,app.indexOf('const theme=')),c);
 vm.runInContext('Blockly.Events.disable();const workspace=new Blockly.Workspace();',c);
 vm.runInContext(app.slice(app.indexOf('function expression('),app.indexOf('function check(){')),c);
 return c;
}

test('language preference is browser-local, validates query values and tolerates blocked storage',()=>{
 const storage={getItem:key=>{assert.equal(key,LANGUAGE_KEY);return 'en';}};
 assert.equal(preferredLanguage(storage),'en');assert.equal(preferredLanguage(storage,'?lang=ja'),'ja');
 assert.equal(preferredLanguage(storage,'?lang=evil'),'en');assert.equal(preferredLanguage({getItem(){throw Error();}}),'ja');
});

test('translation preserves numbers and reports numeric ranges in English',()=>{
 let language='en';const t=makeTranslator(catalog.text,()=>language);
 assert.equal(t('マニュアル PDF'),'PDF manual');assert.equal(t('モーターの速さは -100〜100 の整数にしてください。'),'motor speed: use an integer from -100 to 100.');
 assert.equal(t('CustomProject_123'),'CustomProject_123');language='ja';assert.equal(t('マニュアル PDF'),'マニュアル PDF');
});

test('all EV3 block templates and dropdown choices render in English without changing port values',()=>{
 const c=editor();c.EBLi18n.apply('en');
 const result=JSON.parse(vm.runInContext(`JSON.stringify(Object.keys(Blockly.Blocks).filter(type=>type.startsWith('ev3_')).map(type=>{const b=workspace.newBlock(type);return {type,tip:b.getTooltip(),fields:b.inputList.flatMap(i=>i.fieldRow).map(f=>({name:f.name,text:f.getText(),input:f instanceof Blockly.FieldTextInput,userLabel:/^(ARG_NAME|LABEL\\d+)$/.test(f.name),options:f instanceof Blockly.FieldDropdown?f.getOptions(false).map(o=>o[0]):[]}))};}))`,c));
 assert.equal(result.length,138);
 for(const b of result){
  assert.doesNotMatch(b.tip,/[ぁ-龯]/,b.type+' tooltip');
  for(const f of b.fields){if(!f.input&&!f.userLabel)assert.doesNotMatch(f.text,/[ぁ-龯]/,b.type+' '+f.name);for(const option of f.options)if(typeof option==='string')assert.doesNotMatch(option,/[ぁ-龯]/,b.type+' option');}
 }
});

test('repeated language rebuilds preserve Japanese user names, multi-results, IDs and input values',()=>{
 const c=editor();
 const initial=vm.runInContext(`const def=saveMyBlock(workspace,'計測と計算',[{name:'距離'},{name:'速さ'}],null,true,['和','差']);
 const text=workspace.newBlock('ev3_text');text.setFieldValue('変数と引数のテスト','TEXT');
 const variable=workspace.getVariableMap().createVariable('モーターの値');
 const call=workspace.newBlock('procedures_callreturn');call.loadExtraState({name:'計測と計算',params:['距離','速さ'],outputs:['和','差']});call.setFieldValue('1','RESULT');
 JSON.stringify(Blockly.serialization.workspaces.save(workspace));`,c);
 for(const lang of ['en','ja','en','ja']){
  c.EBLi18n.apply(lang);c.saved=initial;
  const actual=vm.runInContext('Blockly.serialization.workspaces.load(JSON.parse(saved),workspace);JSON.stringify(Blockly.serialization.workspaces.save(workspace));',c);
  assert.deepEqual(JSON.parse(actual),JSON.parse(initial));
 }
});

test('all shipped project samples retain identical serialized data when loaded in either language',()=>{
 const c=editor();const dir=new URL('../dist/samples/',import.meta.url);
 for(const name of readdirSync(dir).filter(n=>n.endsWith('.ev3lab'))){
  const data=JSON.parse(readFileSync(new URL(name,dir),'utf8'));c.lesson=JSON.stringify(data.workspace??data);
  const states=[];
  for(const lang of ['ja','en']){c.EBLi18n.apply(lang);const saved=vm.runInContext('Blockly.serialization.workspaces.load(JSON.parse(lesson),workspace);JSON.stringify(Blockly.serialization.workspaces.save(workspace));',c);states.push(JSON.parse(saved));c.lesson=saved;}
  assert.deepEqual(states[0],states[1],name);
 }
});

test('toolbox translation changes only category and instructional labels, never saved fields or definition names',()=>{
 const c=editor();c.EBLi18n.apply('en');
 const source={kind:'category',name:'動き',contents:[{kind:'label',text:'旋回前にタイヤ直径・トレッドを設定'},{kind:'block',type:'ev3_text',fields:{TEXT:'動き'}}]};
 const result=c.EBLi18n.toolbox(source);assert.equal(result.name,'Movement');assert.equal(result.contents[1].fields.TEXT,'動き');assert.equal(source.name,'動き');assert.doesNotMatch(result.contents[0].text,/[ぁ-龯]/);
 assert.equal(c.EBLi18n.toolbox({kind:'button',text:'「モーター」を編集',callbackKey:'EV3_EDIT_123'}).text,'Edit “モーター”');
});

test('language changes leave generated executable bytes identical for a called numeric My Block',()=>{
 const c=editor();
 vm.runInContext(`const def=saveMyBlock(workspace,'計算',[],null,true,['結果']);
 def.getInputTargetBlock('RETURN').setFieldValue(660,'NUM');
 const start=workspace.newBlock('ev3_start'),tone=workspace.newBlock('ev3_tone'),call=workspace.newBlock('procedures_callreturn');
 call.loadExtraState({name:'計算',params:[],outputs:['結果']});
 tone.getInput('FREQUENCY').connection.connect(call.outputConnection);
 const ms=workspace.newBlock('math_number');ms.setFieldValue(200,'NUM');tone.getInput('MS').connection.connect(ms.outputConnection);start.nextConnection.connect(tone.previousConnection);
 `,c);
 const before=JSON.parse(vm.runInContext('JSON.stringify(program())',c));
 c.saved=vm.runInContext('JSON.stringify(Blockly.serialization.workspaces.save(workspace))',c);c.EBLi18n.apply('en');
 const after=JSON.parse(vm.runInContext('Blockly.serialization.workspaces.load(JSON.parse(saved),workspace);JSON.stringify(program())',c));
 assert.deepEqual(after,before);assert.deepEqual(compile(after).data,compile(before).data);
});

test('both manual editions and locale scripts are linked and shipped as local assets',()=>{
 const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 assert.match(html,/id="uiLanguage"/);assert.match(html,/data-language="en"/);assert.match(html,/i18n-bootstrap\.js/);
 for(const stem of ['EV3-Block-Lab-Manual-v0.25.5-en','EV3-Block-Lab-ブロック命令マニュアル-v0.25.5']){
  assert.match(readFileSync(new URL('../dist/manual/'+stem+'.html',import.meta.url),'utf8'),/chapter-20/);
  assert.equal(readFileSync(new URL('../dist/manual/'+stem+'.pdf',import.meta.url)).subarray(0,4).toString(),'%PDF');
 }
});

test('the live switch adapter keeps the connection, saves the project and refuses changes during communication',()=>{
 const c=editor();
 vm.runInContext(`let busy=false,loading=false,saves=0,checks=0,error='';
 const connection=Object.freeze({connected:true,marker:'unchanged'});
 workspace.getToolbox=()=>({clearSelection(){}});workspace.updateToolbox=()=>{};
 function check(){checks++;}function saveLocal(){saves++;}function feedback(message){error=message;}
 function requestAnimationFrame(){};
 const wait=workspace.newBlock('ev3_wait_seconds');const number=workspace.newBlock('math_number');number.setFieldValue(1.5,'NUM');wait.getInput('SECONDS').connection.connect(number.outputConnection);
 `,c);
 vm.runInContext(app.slice(app.indexOf('globalThis.EBLi18n?.attach({')),c);
 c.languageSelect.value='en';c.languageSelect.onchange();assert.equal(c.EBLi18n.language,'en');
 assert.equal(vm.runInContext('connection.connected&&connection.marker==="unchanged"&&saves===1&&checks===1&&!loading',c),true);
 assert.equal(vm.runInContext('workspace.getAllBlocks(false).find(b=>b.type==="math_number").getFieldValue("NUM")',c),1.5);
 vm.runInContext('busy=true',c);c.languageSelect.value='ja';c.languageSelect.onchange();
 assert.equal(c.EBLi18n.language,'en');assert.match(vm.runInContext('error',c),/Wait for communication/);assert.equal(vm.runInContext('saves',c),1);
});
