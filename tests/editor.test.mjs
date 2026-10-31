import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile,programFileName} from '../dist/ev3.js';
import {inspectBlocks,createBlockLibrary,mergeBlockLibrary} from '../dist/library.js';
import {sensorReading} from '../dist/sensor-monitor.js';
const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
// Blockly's headless shadow serialization still creates XML nodes. Supply
// only that DOM surface; no browser or rendering is emulated by these tests.
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
 const elements=new Map();
 const context=vm.createContext({console,setTimeout,clearTimeout,structuredClone,XMLSerializer:class{serializeToString(n){return '<'+n.nodeName+' '+[...n.attrs].map(([k,v])=>k+'='+JSON.stringify(v)).join(' ')+'>'+n.childNodes.map(c=>this.serializeToString(c)).join('')+'</'+n.nodeName+'>'; }},document:{createElementNS:(_ns,name)=>new XmlNode(name),createTextNode:text=>new XmlNode('#text',3,text),querySelector:()=>({}),getElementById:id=>{if(!elements.has(id))elements.set(id,{value:id==='pairMode'?'independent':'',textContent:''});return elements.get(id);}}});
 for(const file of ['blockly_compressed.js','blocks_compressed.js','ja.js'])vm.runInContext(readFileSync(new URL('../dist/vendor/'+file,import.meta.url),'utf8'),context);
 const prefix=app.slice(app.indexOf('\n')+1,app.indexOf('const theme='));vm.runInContext(prefix,context);
 vm.runInContext('const workspace=new Blockly.Workspace();',context);
 vm.runInContext(app.slice(app.indexOf('function expression('),app.indexOf('function check(){')),context);
 return context;
}

test('brick button palette and saved definitions retain selected buttons and released conditions',()=>{
 const context=editor();
 const result=JSON.parse(vm.runInContext(`
 Blockly.Events.disable();const def=saveMyBlock(workspace,'ボタン待ち',[]),wait=workspace.newBlock('ev3_wait_until'),condition=workspace.newBlock('ev3_brick_button');condition.setFieldValue('4','BUTTON');condition.setFieldValue('0','STATE');def.getInput('STACK').connection.connect(wait.previousConnection);wait.getInput('BOOL').connection.connect(condition.outputConnection);
 const start=workspace.newBlock('ev3_start'),call=workspace.newBlock('procedures_callnoreturn');call.loadExtraState({name:'ボタン待ち',params:[]});start.nextConnection.connect(call.previousConnection);
 const numeric=workspace.newBlock('ev3_brick_button_value');numeric.setFieldValue('7','BUTTON');const reading=expression(numeric),saved=Blockly.serialization.workspaces.save(workspace);Blockly.serialization.workspaces.load(saved,workspace);const built=program();const types=toolbox.contents.find(c=>c.name==='センサー').contents.map(x=>x.type);Blockly.Events.enable();JSON.stringify({value:reading,program:built,types});`,context));
 assert.deepEqual(result.value,{button:{id:7}});
 assert.deepEqual(result.program.procedures[0].body[0].condition,{op:'eq',left:{button:{id:4}},right:0});
 assert.ok(!result.types.includes('ev3_brick_button'));assert.ok(!result.types.includes('ev3_brick_button_value'));
 compile(result.program);
});

test('control exit blocks are caps, retain saved behavior and reject My Block return in main',()=>{
 const context=editor();
 const result=JSON.parse(vm.runInContext(`
 Blockly.Events.disable();const start=workspace.newBlock('ev3_start'),end=workspace.newBlock('ev3_program_end'),ret=workspace.newBlock('ev3_myblock_return');start.nextConnection.connect(end.previousConnection);const def=saveMyBlock(workspace,'途中で戻る',[]);def.getInput('STACK').connection.connect(ret.previousConnection);const caps=!end.nextConnection&&!ret.nextConnection;
 const saved=Blockly.serialization.workspaces.save(workspace);Blockly.serialization.workspaces.load(saved,workspace);const first=program();const restored=workspace.getAllBlocks(false).find(b=>b.type==='ev3_myblock_return');const returned=chain(restored);
 restored.previousConnection.disconnect();workspace.getAllBlocks(false).find(b=>b.type==='ev3_program_end').dispose();workspace.getAllBlocks(false).find(b=>b.type==='ev3_start').nextConnection.connect(restored.previousConnection);let error='';try{program();}catch(e){error=e.message;}Blockly.Events.enable();JSON.stringify({caps,first,returned,error,types:toolbox.contents.find(c=>c.name==='制御').contents.map(x=>x.type)});`,context));
 assert.equal(result.caps,true);assert.deepEqual(result.first.main,[{type:'programEnd'}]);assert.deepEqual(result.returned,[{type:'myblockReturn'}]);assert.match(result.error,/定義の中/);assert.ok(result.types.includes('ev3_program_end'));assert.ok(result.types.includes('ev3_myblock_return'));compile(result.first);
});

// Blockly自身の復元だけでなく、実際のファイル入力時の許可一覧を通して検証する。
function savedButtonExitLesson(){
 const context=editor();
 return JSON.parse(vm.runInContext(`Blockly.Events.disable();
 const def=saveMyBlock(workspace,'ボタンで戻る',[]),variable=workspace.getVariableMap().createVariable('押下値'),set=workspace.newBlock('variables_set'),reading=workspace.newBlock('ev3_brick_button_value');set.setFieldValue(variable.getId(),'VAR');reading.setFieldValue('7','BUTTON');set.getInput('VALUE').connection.connect(reading.outputConnection);def.getInput('STACK').connection.connect(set.previousConnection);
 const branch=workspace.newBlock('controls_if');branch.loadExtraState({hasElse:true});set.nextConnection.connect(branch.previousConnection);const button=workspace.newBlock('ev3_brick_button');button.setFieldValue('4','BUTTON');button.setFieldValue('0','STATE');branch.getInput('IF0').connection.connect(button.outputConnection);branch.getInput('DO0').connection.connect(workspace.newBlock('ev3_myblock_return').previousConnection);branch.getInput('ELSE').connection.connect(workspace.newBlock('ev3_program_end').previousConnection);
 const start=workspace.newBlock('ev3_start'),call=workspace.newBlock('procedures_callnoreturn');call.loadExtraState({name:'ボタンで戻る',params:[]});start.nextConnection.connect(call.previousConnection);ensureArgumentInputs();const state=Blockly.serialization.workspaces.save(workspace);Blockly.Events.enable();JSON.stringify({state,program:program()});`,context));
}

test('actual project save and restore accepts brick button and both exit blocks without losing settings',()=>{
 const fixture=savedButtonExitLesson(),context=editor();context.inspectBlocks=inspectBlocks;context.programFileName=programFileName;context.lesson=JSON.stringify({format:'ev3-block-lab',version:1,programName:'ButtonsEnd',ev3ProjectName:'Class1',workspace:fixture.state});
 vm.runInContext(`let loading=false,dirty=true;function check(){};const downloads=[];function download(data,name,type){downloads.push({data:JSON.parse(data),name,type});}function feedback(message){throw Error(message);}`,context);
 vm.runInContext(app.slice(app.indexOf('function project(){'),app.indexOf('function saveLocal(){')),context);
 vm.runInContext(app.slice(app.indexOf("$('saveProject').onclick="),app.indexOf("$('loadProject').onclick=")),context);
 const result=JSON.parse(vm.runInContext(`Blockly.Events.disable();restore(JSON.parse(lesson));$('saveProject').onclick();const file=downloads[0];workspace.clear();restore(JSON.parse(JSON.stringify(file.data)));const built=program();const result={file,built,count:workspace.getAllBlocks(false).length};Blockly.Events.enable();JSON.stringify(result);`,context));
 assert.equal(result.file.name,'ButtonsEnd.ev3lab');assert.deepEqual(result.built,fixture.program);assert.equal(result.count,9);compile(result.built);
});

test('My Block export and import accepts button and exit blocks while preserving the existing project',()=>{
 const fixture=savedButtonExitLesson(),library=JSON.parse(JSON.stringify(createBlockLibrary(fixture.state,'0.16.1')));
 const current={blocks:{languageVersion:0,blocks:[{type:'ev3_start',id:'keep-start'}]}};
 const merged=mergeBlockLibrary(current,library),context=editor();context.lesson=JSON.stringify(merged);
 const result=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(lesson),workspace);const start=workspace.getBlockById('keep-start'),call=workspace.newBlock('procedures_callnoreturn');call.loadExtraState({name:'ボタンで戻る',params:[]});start.nextConnection.connect(call.previousConnection);const built=program();Blockly.Events.enable();JSON.stringify(built);`,context));
 assert.equal(current.blocks.blocks.length,1);assert.deepEqual(result,fixture.program);compile(result);
});

test('all advertised palette blocks pass the external-file block validation',()=>{
 const context=editor();const items=JSON.parse(vm.runInContext(`JSON.stringify(toolbox.contents.flatMap(c=>c.contents??[]).filter(x=>x.kind==='block'))`,context));
 for(const item of items)assert.doesNotThrow(()=>inspectBlocks([item]),item.type);
 assert.throws(()=>inspectBlocks([{type:'unknown_script'}]),/未対応/);
});

test('program names determine saved filenames and preserve EV3 destinations across legacy load, save and reload',()=>{
 const context=editor();context.programFileName=programFileName;context.inspectBlocks=()=>{};
 vm.runInContext(`let loading=false,dirty=true;function check(){};const downloads=[];let error='';function download(data,name,type){downloads.push({data:JSON.parse(data),name,type});}function feedback(message){error=message;}let focused=false;$('programName').focus=()=>focused=true;`,context);
 vm.runInContext(app.slice(app.indexOf('function project(){'),app.indexOf('function saveLocal(){')),context);
 vm.runInContext(app.slice(app.indexOf("$('saveProject').onclick="),app.indexOf("$('loadProject').onclick=")),context);
 const result=JSON.parse(vm.runInContext(`
 Blockly.Events.disable();workspace.newBlock('ev3_start');const old={format:'ev3-block-lab',version:1,name:'古い作品名',ev3ProjectName:'Class1',programName:'LineTrace',pairMode:'feedback',workspace:Blockly.serialization.workspaces.save(workspace)};
 restore(old);$('saveProject').onclick();const first=downloads[0];$('programName').value='Changed';$('ev3ProjectName').value='Other';restore(first.data);const loaded=project();
 $('programName').value='Turn_90';$('saveProject').onclick();const renamed=downloads[1];
 $('programName').value='../bad';dirty=true;$('saveProject').onclick();
 Blockly.Events.enable();JSON.stringify({first,loaded,renamed,count:downloads.length,error,focused,dirty});`,context));
 assert.equal(result.first.name,'LineTrace.ev3lab');assert.equal(result.first.type,'application/json');assert.equal(result.loaded.programName,'LineTrace');assert.equal(result.loaded.ev3ProjectName,'Class1');assert.equal(result.loaded.pairMode,'feedback');assert.equal(result.loaded.name,'LineTrace');assert.equal(result.loaded.workspace.blocks.blocks[0].type,'ev3_start');assert.equal(result.renamed.name,'Turn_90.ev3lab');assert.equal(result.renamed.data.programName,'Turn_90');assert.equal(result.count,2);assert.ok(result.error);assert.equal(result.focused,true);assert.equal(result.dirty,true);
});

test('transfer buttons keep save-only and verified-run separate and preserve verified files on start failure',async()=>{
 const context=editor();context.programFileName=programFileName;
 vm.runInContext(`let busy=false,savedPath='',pollsStopped=0;const sent=[];let failStart=false;const connection={transferWithSignal:async(data,name,progress,folder)=>{sent.push({kind:'save',name,folder});return {path:'../prjs/'+folder+'/'+name,soundError:null};},transferAndRun:async(data,name,progress,folder)=>{sent.push({kind:'run',name,folder});if(failStart){const e=Error('start failed');e.verifiedPath='../prjs/'+folder+'/'+name;throw e;}return {path:'../prjs/'+folder+'/'+name,soundError:null};},stopProgram:async()=>sent.push({kind:'stop'})};function check(){return {data:new Uint8Array([1,2]),program:{}};}function log(){}function feedback(text){$('transferResult').textContent=text;}function updateButtons(){}function stopSensorMonitor(){pollsStopped++;}$('programName').value='Line';$('ev3ProjectName').value='Class1';`,context);
 vm.runInContext(app.slice(app.indexOf('function fileName(){'),app.indexOf("$('downloadRbf').onclick=")),context);
 await vm.runInContext(`$('transfer').onclick()`,context);assert.match(vm.runInContext(`$('transferResult').textContent`,context),/本体でこのプログラム/);
 await vm.runInContext(`$('transferRun').onclick()`,context);assert.match(vm.runInContext(`$('transferResult').textContent`,context),/起動命令/);
 await vm.runInContext(`failStart=true;$('transferRun').onclick()`,context);assert.match(vm.runInContext(`$('transferResult').textContent`,context),/転送・照合は完了/);assert.equal(vm.runInContext('savedPath',context),'../prjs/Class1/Line.rbf');assert.equal(vm.runInContext('busy',context),false);
 await vm.runInContext(`$('stopProgram').onclick()`,context);assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(sent.map(x=>x.kind))',context)),['save','run','run','stop']);
});

test('sensor panel renders current readings and clears them after a failed or disconnected read',async()=>{
 const context=editor();context.sensorReading=sensorReading;
 vm.runInContext(`let busy=false,monitorTimer=null;function updateButtons(){}const connection={connected:true,readSensorSnapshot:async()=>({inputs:[{port:1,type:29,mode:0,value:35},{port:2,type:30,mode:0,value:12.5}],motors:[{port:'B',value:-360},{port:'C',value:null}]})};`,context);
 vm.runInContext(app.slice(app.indexOf('function stopSensorMonitor(){')),context);
 await vm.runInContext('refreshSensorValues()',context);assert.equal(vm.runInContext(`$('sensorValue1').textContent`,context),'35 %');assert.equal(vm.runInContext(`$('motorValueB').textContent`,context),'-360°');assert.equal(vm.runInContext(`$('motorValueC').textContent`,context),'—');
 await vm.runInContext(`connection.readSensorSnapshot=async()=>{throw Error('unplugged');};refreshSensorValues()`,context);assert.equal(vm.runInContext(`$('sensorValue1').textContent`,context),'—');assert.equal(vm.runInContext(`$('autoSensors').checked`,context),false);assert.equal(vm.runInContext('busy',context),false);assert.match(vm.runInContext(`$('sensorMonitorStatus').textContent`,context),/unplugged/);
});

test('plain procedure form creates and edits arguments while retaining callers and scoped references',()=>{
 const context=editor();
 const result=JSON.parse(vm.runInContext(`
 Blockly.Events.disable();
 const def=saveMyBlock(workspace,'移動',[{name:'距離'},{name:'速さ'}]);
 const models=def.getVarModels(),distance=models[0].getId(),speed=models[1].getId();
 const start=workspace.newBlock('ev3_start'),call=workspace.newBlock('procedures_callnoreturn');
 call.loadExtraState({name:'移動',params:['距離','速さ']});start.nextConnection.connect(call.previousConnection);
 const arg=workspace.newBlock('ev3_argument');arg.loadExtraState({parameterId:distance,name:'距離'});
 const wait=workspace.newBlock('ev3_wait_seconds');def.getInput('STACK').connection.connect(wait.previousConnection);wait.getInput('SECONDS').connection.connect(arg.outputConnection);
 ensureArgumentInputs();call.getInputTargetBlock('ARG0').setFieldValue('2','NUM');call.getInputTargetBlock('ARG1').setFieldValue('20','NUM');
 const global=workspace.getVariableMap().getVariable('距離','');
 saveMyBlock(workspace,'走行',[{id:speed,name:'速度'},{id:distance,name:'長さ'},{name:'回数'}],def.id);
 ensureArgumentInputs();
 const values=[0,1,2].map(i=>call.getInputTargetBlock('ARG'+i).getFieldValue('NUM'));
 if(arg.getFieldValue('ARG_NAME')!=='長さ')throw Error('Body argument rename failed');
 if(global.getName()!=='距離')throw Error('Global variable was renamed');
 if(def.getIcon(Blockly.icons.MutatorIcon.TYPE))throw Error('Gear still present');
 const before=JSON.stringify(Blockly.serialization.workspaces.save(workspace));
 let rejected=false;try{saveMyBlock(workspace,'走行',[{id:speed,name:'速度'}],def.id);}catch{rejected=true;}
 if(!rejected||before!==JSON.stringify(Blockly.serialization.workspaces.save(workspace)))throw Error('Used parameter removal changed workspace');
 const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);
 const programResult=program();Blockly.Events.enable();JSON.stringify({values,p:programResult});
 `,context));
 assert.deepEqual(result.values,[20,2,0]);assert.equal(result.p.procedures[0].name,'走行');
 assert.ok(compile(result.p).data.length>28);
});

test('plain procedure form rejects duplicate names and arguments before changing the project',()=>{
 const context=editor();
 assert.equal(vm.runInContext(`Blockly.Events.disable();saveMyBlock(workspace,'前進',[]);let rejected=0;for(const [name,params] of [['前進',[]],['別名',[{name:'距離'},{name:'距離'}]],['',[]],['別名',[{name:''}]]])try{saveMyBlock(workspace,name,params);}catch{rejected++;}Blockly.Events.enable();rejected;`,context),4);
});

 test('all paired L/M motor choices survive saving and compile in every angle control mode',()=>{
 const context=editor();
 const results=JSON.parse(vm.runInContext(`
 Blockly.Events.disable();const result=[];
 for(const kind of ['ev3_motor','ev3_motor_m'])for(const ports of [3,5,9,6,10,12])for(const mode of ['independent','feedback','sync']){
  workspace.clear();$('pairMode').value=mode;
  const start=workspace.newBlock('ev3_start'),motor=workspace.newBlock(kind);motor.setFieldValue(String(ports),'PORTS');
  if(Number(motor.getFieldValue('PORTS'))!==ports)throw Error('Missing angle port pair');
  const n=(field,value)=>{const b=workspace.newBlock('math_number');b.setFieldValue(String(value),'NUM');motor.getInput(field).connection.connect(b.outputConnection);};n('SPEED',20);n('DEGREES',360);start.nextConnection.connect(motor.previousConnection);
  const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);result.push(program());
  for(const type of ['ev3_motor_l_run','ev3_motor_m_run','ev3_motor_m_time']){const extra=workspace.newBlock(type);extra.setFieldValue(String(ports),'PORTS');if(Number(extra.getFieldValue('PORTS'))!==ports)throw Error('Missing '+type+' port pair');}
 }
 Blockly.Events.enable();JSON.stringify(result);
 `,context));
 assert.equal(results.length,36);
 for(let i=0;i<results.length;i++){assert.equal(results[i].main[0].ports,[3,5,9,6,10,12][Math.floor((i%18)/3)]);assert.equal(results[i].main[0].mode,['independent','feedback','sync'][i%3]);assert.ok(compile(results[i]).data.length>28);}
});
test('all advertised Blockly blocks construct and the toolbox has no missing definitions',()=>{
 const context=editor();
 const count=vm.runInContext(`let built=0;for(const category of toolbox.contents)for(const item of category.contents??[])if(item.kind==='block'){const b=workspace.newBlock(item.type);if(item.extraState)b.loadExtraState(item.extraState);if(item.extraState?.hasElse&&!b.getInput('ELSE'))throw Error('Missing else input');b.dispose();built++;}built;`,context);
 assert.ok(count>0); for(const type of ['ev3_motor_m','ev3_motor_m_time','ev3_drive_forward','ev3_drive_backward','ev3_math','controls_if','controls_whileUntil'])assert.ok(vm.runInContext('!!Blockly.Blocks['+JSON.stringify(type)+']',context),type);
});

test('encoder, reset, touch and all infrared blocks retain ports and channels through library reuse',()=>{
 const context=editor();
 const saved=vm.runInContext(`
 Blockly.Events.disable();const def=workspace.newBlock('procedures_defnoreturn');def.setFieldValue('センサ授業','NAME');let tail=def.getInput('STACK').connection;
 const reset=workspace.newBlock('ev3_encoder_reset');reset.setFieldValue('4','PORT');tail.connect(reset.previousConnection);tail=reset.nextConnection;
 for(const [index,type]of ['ev3_encoder','ev3_touch','ev3_touch_value','ev3_ir_proximity','ev3_ir_compare','ev3_ir_remote','ev3_ir_button','ev3_ir_beacon_detected','ev3_ir_beacon_heading','ev3_ir_beacon_distance'].entries()){
  const b=workspace.newBlock(type);b.setFieldValue('4','PORT');if(b.getField('CHANNEL'))b.setFieldValue('4','CHANNEL');
  if(b.getField('STATE'))b.setFieldValue('0','STATE');if(b.getField('BUTTON'))b.setFieldValue('11','BUTTON');
  if(b.getInput('VALUE')){const n=workspace.newBlock('math_number');n.setFieldValue(20,'NUM');b.getInput('VALUE').connection.connect(n.outputConnection);}
  const model=workspace.getVariableMap().createVariable('結果'+index),set=workspace.newBlock('variables_set');set.setFieldValue(model.getId(),'VAR');set.getInput('VALUE').connection.connect(b.outputConnection);tail.connect(set.previousConnection);tail=set.nextConnection;
 }
 const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);const saved=Blockly.serialization.workspaces.save(workspace);Blockly.Events.enable();JSON.stringify(saved);
 `,context);
 context.sensorLesson=JSON.stringify(mergeBlockLibrary({blocks:{languageVersion:0,blocks:[{type:'ev3_start'}]}},createBlockLibrary(JSON.parse(saved),'0.6.0')));
 const p=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(sensorLesson),workspace);const start=workspace.getAllBlocks(false).find(b=>b.type==='ev3_start'),call=workspace.newBlock('procedures_callnoreturn');call.loadExtraState({name:'センサ授業',params:[]});start.nextConnection.connect(call.previousConnection);const p=program();Blockly.Events.enable();JSON.stringify(p);`,context));
 assert.deepEqual(p.procedures[0].body[0],{type:'encoderReset',port:4});
 const expressions=p.procedures[0].body.slice(1).map(b=>b.value),readings=expressions.map(x=>x.sensor??x.left.sensor);
 assert.deepEqual(readings.map(s=>s.kind),['encoder','touch','touch','infrared','infrared','irRemote','irRemote','irBeaconDetected','irBeaconHeading','irBeaconDistance']);
 assert.ok(readings.every(s=>s.port===4));assert.ok(readings.slice(5).every(s=>s.channel===4));assert.equal(expressions[1].right,0);assert.equal(expressions[6].right,11);assert.ok(compile(p).usesSensors);
});

test('per-port stops preserve all four selections through project and My Block library round trips',()=>{
 const context=editor();
 const saved=vm.runInContext(`
 Blockly.Events.disable();const def=workspace.newBlock('procedures_defnoreturn');def.setFieldValue('個別停止','NAME');let tail=def.getInput('STACK').connection;
 for(const ports of [1,2,4,8]){const b=workspace.newBlock('ev3_stop_port');b.setFieldValue(String(ports),'PORTS');tail.connect(b.previousConnection);tail=b.nextConnection;}
 const all=workspace.newBlock('ev3_stop');tail.connect(all.previousConnection);
 const saved=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(saved,workspace);const again=Blockly.serialization.workspaces.save(workspace);Blockly.Events.enable();JSON.stringify(again);
 `,context);
 const merged=mergeBlockLibrary({blocks:{languageVersion:0,blocks:[{type:'ev3_start'}]}},createBlockLibrary(JSON.parse(saved),'0.5.6'));context.importStops=JSON.stringify(merged);
 const p=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(importStops),workspace);const start=workspace.getAllBlocks(false).find(b=>b.type==='ev3_start'),call=workspace.newBlock('procedures_callnoreturn');call.loadExtraState({name:'個別停止',params:[]});start.nextConnection.connect(call.previousConnection);const p=program();Blockly.Events.enable();JSON.stringify(p);`,context));
 assert.deepEqual(p.procedures[0].body,[1,2,4,8].map(ports=>({type:'stop',ports})).concat({type:'stop'}));assert.ok(compile(p).data.length>28);
});

test('L and M palettes separate one motor from a pair with matching run, angle and seconds blocks',()=>{
 const context=editor();
 const result=JSON.parse(vm.runInContext(`
 Blockly.Events.disable();const items=toolbox.contents.find(c=>c.name==='モーター').contents,results=[];
 for(const kind of ['l','m'])for(const group of ['single','pair'])for(const action of ['run','angle','time']){
  const type='ev3_motor_'+kind+'_'+group+'_'+action;
  if(items.filter(i=>i.type===type).length!==1)throw Error('Missing palette block '+type);
  const b=workspace.newBlock(type),ports=b.getField('PORTS').getOptions(false).map(o=>Number(o[1])).sort((a,b)=>a-b);
  results.push({kind,group,action,ports});
 }
 Blockly.Events.enable();JSON.stringify(results);
 `,context));
 assert.equal(result.length,12);
 for(const row of result)assert.deepEqual(row.ports,row.group==='single'?[1,2,4,8]:[3,5,6,9,10,12]);
});

test('all new motor blocks retain wiring, fractional seconds and control modes through My Block library reuse',()=>{
 const context=editor();
 const saved=vm.runInContext(`
 Blockly.Events.disable();const def=workspace.newBlock('procedures_defnoreturn');def.setFieldValue('モーター授業','NAME');let tail=def.getInput('STACK').connection;
 for(const kind of ['l','m'])for(const group of ['single','pair'])for(const action of ['run','angle','time']){
  const b=workspace.newBlock('ev3_motor_'+kind+'_'+group+'_'+action);b.setFieldValue(group==='pair'?'9':'8','PORTS');
  for(const [name,value] of [['SPEED',-20],...(action==='angle'?[['DEGREES',360]]:action==='time'?[['SECONDS',1.25]]:[])]){const n=workspace.newBlock('math_number');n.setFieldValue(String(value),'NUM');b.getInput(name).connection.connect(n.outputConnection);}
  tail.connect(b.previousConnection);tail=b.nextConnection;
 }
 const saved=Blockly.serialization.workspaces.save(workspace);Blockly.Events.enable();JSON.stringify(saved);
 `,context);
 const state=JSON.parse(saved),merged=mergeBlockLibrary({blocks:{languageVersion:0,blocks:[{type:'ev3_start'}]}},createBlockLibrary(state,'0.5.4'));
 context.mergedMotorLesson=JSON.stringify(merged);
 const p=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(mergedMotorLesson),workspace);const start=workspace.getAllBlocks(false).find(b=>b.type==='ev3_start'),call=workspace.newBlock('procedures_callnoreturn');call.loadExtraState({name:'モーター授業',params:[]});start.nextConnection.connect(call.previousConnection);$('pairMode').value='sync';const p=program();Blockly.Events.enable();JSON.stringify(p);`,context));
 assert.equal(p.procedures[0].body.length,12);
 for(const [i,b]of p.procedures[0].body.entries()){
  assert.equal(b.ports,Math.floor(i/3)%2===0?8:9);assert.equal(b.speed,-20);
  if(b.type==='motorTimed')assert.equal(b.seconds,1.25);
  if(b.type==='motor'){assert.equal(b.degrees,360);assert.equal(b.mode,'sync');}
 }
 assert.ok(compile(p).data.length>28);
});
test('the variable-and-branch classroom sample builds a compilable Blockly program',()=>{
 const context=editor();
 vm.runInContext('let dirty=false,loading=false;function saveLocal(){}function feedback(){}function check(){}',context);
 const sample=app.slice(app.indexOf("$('controlSample').onclick="),app.indexOf("$('driveSample').onclick="));
 vm.runInContext(sample,context);
 vm.runInContext("$('controlSample').onclick();",context);
 const p=JSON.parse(vm.runInContext('JSON.stringify(program())',context));
 assert.equal(p.main[1].type,'while');assert.equal(p.main[1].body[1].else.length,1);
 assert.ok(compile(p).data.length>28);
});
test('saved Blockly variables and distance expressions round-trip into compilable native EV3 code',()=>{
 const context=editor();
 const number=n=>({block:{type:'math_number',fields:{NUM:n}}});
 const drive={type:'ev3_drive_forward',fields:{PORTS:'6'},inputs:{SPEED:number(20),CM:{block:{type:'variables_get',fields:{VAR:{id:'counter'}}}}}};
 const set={type:'variables_set',fields:{VAR:{id:'counter'}},inputs:{VALUE:number(20)},next:{block:drive}};
 const wheel={type:'ev3_wheel',fields:{DIAMETER:56},next:{block:set}};
 const input={blocks:{languageVersion:0,blocks:[{type:'ev3_start',next:{block:wheel}}]},variables:[{id:'counter',name:'距離'}]};
 context.inputState=JSON.stringify(input);
 const result=vm.runInContext(`
 const input=JSON.parse(inputState);
 Blockly.serialization.workspaces.load(input,workspace);
 const state=Blockly.serialization.workspaces.save(workspace);
 workspace.clear();Blockly.serialization.workspaces.load(state,workspace);
 JSON.stringify(program());`,context);
 const p=JSON.parse(result);assert.equal(p.main[2].cm.var,'距離');assert.ok(compile(p).data.length>28);
});

test('spin-turn Blockly sample round-trips and supplies both motor ports and geometry',()=>{
 const context=editor();
 vm.runInContext('let dirty=false,loading=false;function saveLocal(){}function feedback(){}function check(){}',context);
 vm.runInContext(app.slice(app.indexOf("$('spinSample').onclick="),app.indexOf("$('controlSample').onclick=")),context);
 vm.runInContext("$('spinSample').onclick();const saved=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(saved,workspace);",context);
 const p=JSON.parse(vm.runInContext('JSON.stringify(program())',context));
 assert.equal(p.main[0].diameter,56);assert.equal(p.main[1].mm,112);assert.equal(p.main[2].leftPort,2);assert.equal(p.main[2].rightPort,4);assert.equal(p.main[2].direction,'right');assert.equal(p.main[4].direction,'left');
 assert.ok(compile(p).diagnosticPath);
});

test('empty My Block arguments become editable number shadows, preserving values and expressions',()=>{
 const context=editor();
 const result=vm.runInContext(`
 Blockly.Events.disable();
 const call=workspace.newBlock('procedures_callnoreturn');
 call.loadExtraState({name:'前進',params:['距離','スピード']});
 ensureArgumentInputs();
 const first=call.getInputTargetBlock('ARG0'),second=call.getInputTargetBlock('ARG1');
 const initial={first:first?.type,second:second?.type,shadow:first?.isShadow(),value:first?.getFieldValue('NUM'),inline:call.getInputsInline()};
 first.setFieldValue('25','NUM');ensureArgumentInputs();
 const retained=call.getInputTargetBlock('ARG0').getFieldValue('NUM');
 call.setInputsInline(false);const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);ensureArgumentInputs();
 const loaded=workspace.getAllBlocks(false).find(b=>b.type==='procedures_callnoreturn');
 const restored=loaded.getInputTargetBlock('ARG0').getFieldValue('NUM'),restoredInline=loaded.getInputsInline();
 const variable=workspace.getVariableMap().createVariable('長さ');
 const expressionBlock=workspace.newBlock('variables_get');expressionBlock.setFieldValue(variable.getId(),'VAR');
 loaded.getInput('ARG0').connection.connect(expressionBlock.outputConnection);ensureArgumentInputs();
 const expressionKept=loaded.getInputTargetBlock('ARG0')===expressionBlock;
 expressionBlock.unplug();ensureArgumentInputs();
 const fallback=loaded.getInputTargetBlock('ARG0').getFieldValue('NUM');
 loaded.loadExtraState({name:'前進',params:['距離','スピード','回数']});ensureArgumentInputs();
 const added=loaded.getInputTargetBlock('ARG2')?.type;
 Blockly.Events.enable();
 JSON.stringify({initial,retained,restored,restoredInline,expressionKept,fallback,added});`,context);
 assert.deepEqual(JSON.parse(result),{initial:{first:'math_number',second:'math_number',shadow:true,value:0,inline:true},retained:25,restored:25,restoredInline:true,expressionKept:true,fallback:25,added:'math_number'});
});

test('a saved user-defined procedure with empty distance and speed inputs can be filled and compiled',()=>{
 const context=editor();
 const parameter=(id)=>({block:{type:'variables_get',fields:{VAR:{id}}}});
 const n=value=>({block:{type:'math_number',fields:{NUM:value}}});
 const def={type:'procedures_defnoreturn',fields:{NAME:'前進'},extraState:{params:[{name:'距離',id:'distance'},{name:'スピード',id:'speed'}]},inputs:{STACK:{block:{type:'ev3_drive_forward',fields:{PORTS:'6'},inputs:{SPEED:parameter('speed'),CM:parameter('distance')}}}}};
 const call={type:'procedures_callnoreturn',extraState:{name:'前進',params:['距離','スピード']}};
 context.savedProject=JSON.stringify({variables:[{name:'距離',id:'distance'},{name:'スピード',id:'speed'}],blocks:{languageVersion:0,blocks:[{type:'ev3_start',next:{block:{type:'ev3_wheel',fields:{DIAMETER:56},next:{block:call}}}},def]}});
 const result=vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(savedProject),workspace);ensureArgumentInputs();const call=workspace.getAllBlocks(false).find(b=>b.type==='procedures_callnoreturn');call.getInputTargetBlock('ARG0').setFieldValue('25','NUM');call.getInputTargetBlock('ARG1').setFieldValue('20','NUM');const result=JSON.stringify(program());Blockly.Events.enable();result;`,context);
 const program=JSON.parse(result);assert.deepEqual(program.main[1].args,[25,20]);assert.equal(program.procedures[0].body[0].cm.param,'距離');assert.equal(program.procedures[0].body[0].speed.param,'スピード');assert.ok(compile(program).data.length>28);
});

test('argument names are hidden from ordinary variable palette and dropdowns',()=>{
 const context=editor();
 const result=vm.runInContext(`
 Blockly.Events.disable();
 const def=workspace.newBlock('procedures_defnoreturn');def.setFieldValue('前進','NAME');def.loadExtraState({params:[{name:'距離',id:'param-distance'},{name:'速さ',id:'param-speed'}]});
 const global=workspace.getVariableMap().createVariable('回数');
 const palette=variableFlyout(workspace),argumentsPalette=argumentFlyout(workspace);
 const ordinaryNames=ordinaryVariables(workspace).map(m=>m.name);
 const setter=workspace.newBlock('variables_set');setter.setFieldValue(global.getId(),'VAR');
 const options=setter.getField('VAR').getOptions(false).map(option=>option[1]);
 const argumentEntry=argumentsPalette.find(item=>item.type==='ev3_argument');
 const parameter=workspace.newBlock('ev3_argument');parameter.loadExtraState(argumentEntry.extraState);
 const drive=workspace.newBlock('ev3_drive_forward');def.getInput('STACK').connection.connect(drive.previousConnection);drive.getInput('CM').connection.connect(parameter.outputConnection);
 const read=expression(parameter);
 const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);ensureArgumentInputs();
 const restored=workspace.getAllBlocks(false).find(b=>b.type==='ev3_argument');
 const after=expression(restored),label=restored.getFieldValue('ARG_NAME'),colour=restored.getColour();
 restored.unplug();let outsideError='';try{expression(restored);}catch(e){outsideError=e.message;}
 Blockly.Events.enable();JSON.stringify({ordinaryNames,options,globalId:global.getId(),argumentNames:argumentsPalette.filter(item=>item.type==='ev3_argument').map(item=>item.extraState.name),read,after,label,colour,outsideError});`,context);
 const x=JSON.parse(result);assert.deepEqual(x.ordinaryNames,['回数']);assert.ok(x.options.includes(x.globalId));assert.ok(!x.options.includes('param-distance'));assert.ok(!x.options.includes('param-speed'));assert.deepEqual(x.argumentNames,['距離','速さ']);assert.deepEqual(x.read,{param:'距離'});assert.deepEqual(x.after,x.read);assert.equal(x.label,'距離');assert.equal(x.colour,'#aa597e');assert.match(x.outsideError,/定義したマイブロック/);
});

test('one palette argument works in same-name definitions with separate call values and independent renaming',()=>{
 const context=editor();
 const result=JSON.parse(vm.runInContext(`
 Blockly.Events.disable();
 const first=saveMyBlock(workspace,'前進',[{name:'距離'}]),second=saveMyBlock(workspace,'後退',[{name:'距離'}]);
 const palette=argumentFlyout(workspace).filter(x=>x.type==='ev3_argument');if(palette.length!==1)throw Error('Duplicate palette arguments');
 const references=[];for(const def of [first,second]){const wait=workspace.newBlock('ev3_wait_seconds'),arg=workspace.newBlock('ev3_argument');arg.loadExtraState(palette[0].extraState);def.getInput('STACK').connection.connect(wait.previousConnection);wait.getInput('SECONDS').connection.connect(arg.outputConnection);references.push(arg);}
 // Old library blocks can carry a foreign ID; their name binds to the containing definition.
 references[0].parameterId='old-import-id';const before=expression(references[0]);
 let rejected=false;try{saveMyBlock(workspace,'前進',[],first.id);}catch{rejected=true;}
 const firstId=first.getVarModels()[0].getId();saveMyBlock(workspace,'前進',[{id:firstId,name:'長さ'}],first.id);ensureArgumentInputs();
 const renamed=expression(references[0]),unchanged=expression(references[1]);
 const start=workspace.newBlock('ev3_start');let tail=start.nextConnection;
 for(const [name,value]of [['前進',1],['後退',2],['前進',3]]){const call=workspace.newBlock('procedures_callnoreturn');call.loadExtraState({name,params:[name==='前進'?'長さ':'距離']});tail.connect(call.previousConnection);tail=call.nextConnection;ensureArgumentInputs();call.getInputTargetBlock('ARG0').setFieldValue(value,'NUM');}
 const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);ensureArgumentInputs();const p=program();Blockly.Events.enable();JSON.stringify({before,rejected,renamed,unchanged,state,p});`,context));
 assert.deepEqual(result.before,{param:'距離'});assert.equal(result.rejected,true);assert.deepEqual(result.renamed,{param:'長さ'});assert.deepEqual(result.unchanged,{param:'距離'});assert.deepEqual(result.p.main.map(x=>x.args),[[1],[2],[3]]);assert.deepEqual(result.p.procedures.map(x=>x.params),[['長さ'],['距離']]);assert.ok(compile(result.p).data.length>28);
 const library=createBlockLibrary(result.state,'0.14.0');context.sharedLibrary=JSON.stringify(mergeBlockLibrary({blocks:{languageVersion:0,blocks:[]}},library));
 assert.deepEqual(JSON.parse(vm.runInContext(`Blockly.Events.disable();workspace.clear();Blockly.serialization.workspaces.load(JSON.parse(sharedLibrary),workspace);ensureArgumentInputs();const result=argumentFlyout(workspace).filter(x=>x.type==='ev3_argument').map(x=>x.extraState.name);Blockly.Events.enable();JSON.stringify(result);`,context)),['長さ','距離']);
});

test('legacy parameter getters retain their meaning and purple colour without a prefix',()=>{
 const context=editor();
 const result=vm.runInContext(`
 Blockly.Events.disable();
 const def=workspace.newBlock('procedures_defnoreturn');def.setFieldValue('前進','NAME');def.loadExtraState({params:[{name:'距離',id:'distance'}]});
 const drive=workspace.newBlock('ev3_drive_forward');def.getInput('STACK').connection.connect(drive.previousConnection);
 const legacy=workspace.newBlock('variables_get');legacy.setFieldValue('distance','VAR');drive.getInput('CM').connection.connect(legacy.outputConnection);
 ensureArgumentInputs();const param={kind:legacy.getFieldValue('EV3_KIND'),colour:legacy.getColour(),value:expression(legacy)};
 const variable=workspace.getVariableMap().createVariable('回数'),getter=workspace.newBlock('variables_get');getter.setFieldValue(variable.getId(),'VAR');ensureArgumentInputs();
 const ordinary={kind:getter.getFieldValue('EV3_KIND'),colour:getter.getColour(),value:expression(getter)};
 Blockly.Events.enable();JSON.stringify({param,ordinary,variables:ordinaryVariables(workspace).map(m=>m.name)});`,context);
 assert.deepEqual(JSON.parse(result),{param:{kind:null,colour:'#aa597e',value:{param:'距離'}},ordinary:{kind:null,colour:'#c58245',value:{var:'回数'}},variables:['回数']});
});

test('unconnected experiments and uncalled unfinished definitions remain editable but do not block transfer',()=>{
 const context=editor();
 const result=vm.runInContext(`Blockly.Events.disable();const start=workspace.newBlock('ev3_start'),wait=workspace.newBlock('ev3_wait_seconds'),number=workspace.newBlock('math_number');number.setFieldValue('1','NUM');start.nextConnection.connect(wait.previousConnection);wait.getInput('SECONDS').connection.connect(number.outputConnection);const unused=workspace.newBlock('procedures_defnoreturn');unused.setFieldValue('実験','NAME');const unfinished=workspace.newBlock('ev3_drive_forward');unused.getInput('STACK').connection.connect(unfinished.previousConnection);workspace.newBlock('ev3_math');const p=program();const retained=Blockly.serialization.workspaces.save(workspace).blocks.blocks.length;Blockly.Events.enable();JSON.stringify({p,retained});`,context);
 const x=JSON.parse(result);assert.equal(x.p.procedures.length,0);assert.ok(x.retained>=3);assert.ok(compile(x.p).data.length>28);
});

test('exported setup and parameterized My Blocks can be reused in a fresh project',()=>{
 const number=n=>({block:{type:'math_number',fields:{NUM:n}}});
 const wheel={type:'ev3_wheel',fields:{DIAMETER:56},next:{block:{type:'ev3_tread',fields:{TREAD:112}}}};
 const setup={type:'procedures_defnoreturn',fields:{NAME:'定義'},inputs:{STACK:{block:wheel}}};
 const param={type:'ev3_argument',extraState:{parameterId:'parameter',name:'距離'},fields:{ARG_NAME:'距離'}};
 const drive={type:'ev3_drive_forward',fields:{PORTS:'6'},inputs:{SPEED:number(20),CM:{block:param}}};
 const move={type:'procedures_defnoreturn',fields:{NAME:'前進'},extraState:{params:[{id:'parameter',name:'距離'}]},inputs:{STACK:{block:drive}}};
 const source={variables:[{id:'parameter',name:'距離'}],blocks:{languageVersion:0,blocks:[setup,move]}};
 const target={variables:[{id:'parameter',name:'既存の別変数'}],blocks:{languageVersion:0,blocks:[{type:'ev3_start'}]}};
 const merged=mergeBlockLibrary(target,createBlockLibrary(source,'0.3.0'),()=> 'remapped-parameter');
 const context=editor();context.importState=JSON.stringify(merged);
 const result=vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(importState),workspace);const start=workspace.getAllBlocks(false).find(b=>b.type==='ev3_start');const setup=workspace.newBlock('procedures_callnoreturn');setup.loadExtraState({name:'定義',params:[]});const move=workspace.newBlock('procedures_callnoreturn');move.loadExtraState({name:'前進',params:['距離']});start.nextConnection.connect(setup.previousConnection);setup.nextConnection.connect(move.previousConnection);ensureArgumentInputs();move.getInputTargetBlock('ARG0').setFieldValue('20','NUM');const result=JSON.stringify(program());Blockly.Events.enable();result;`,context);
 const program=JSON.parse(result);assert.equal(program.procedures.length,2);assert.equal(program.procedures[0].body[0].type,'wheel');assert.equal(program.procedures[1].body[0].cm.param,'距離');assert.ok(compile(program).data.length>28);
});

test('color classroom sample saves, reloads and compiles into an on-brick wait and tone',()=>{
 const context=editor();
 vm.runInContext('let dirty=false,loading=false;function saveLocal(){}function feedback(){}function check(){}',context);
 vm.runInContext(app.slice(app.indexOf("$('colorSample').onclick="),app.indexOf("$('controlSample').onclick=")),context);
 const p=JSON.parse(vm.runInContext("$('colorSample').onclick();const savedColor=Blockly.serialization.workspaces.save(workspace);Blockly.serialization.workspaces.load(savedColor,workspace);JSON.stringify(program());",context));
 assert.equal(p.main[0].type,'while');assert.equal(p.main[0].until,true);assert.deepEqual(p.main[0].condition,{op:'eq',left:{sensor:{kind:'color',port:3}},right:5});assert.equal(p.main[1].frequency,880);
 assert.equal(compile(p).usesSensors,true);
});
test('sensor expressions parse and a sensor My Block survives library reuse',()=>{
 const context=editor();
 const result=JSON.parse(vm.runInContext(`
 const def=workspace.newBlock('procedures_defnoreturn');def.setFieldValue('sensorCheck','NAME');
 const set=workspace.newBlock('variables_set'),model=workspace.getVariableMap().createVariable('reading');set.setFieldValue(model.getId(),'VAR');def.getInput('STACK').connection.connect(set.previousConnection);
 const types=['ev3_color_is','ev3_color_value','ev3_reflected','ev3_reflected_compare','ev3_distance','ev3_distance_compare'];
 const expressions=types.map(type=>{const b=workspace.newBlock(type);b.setFieldValue('4','PORT');if(b.getInput('VALUE')){const n=workspace.newBlock('math_number');n.setFieldValue(15,'NUM');b.getInput('VALUE').connection.connect(n.outputConnection);}const result=expression(b);b.dispose();return result;});
 const reading=workspace.newBlock('ev3_reflected');set.getInput('VALUE').connection.connect(reading.outputConnection);
 JSON.stringify({expressions,state:Blockly.serialization.workspaces.save(workspace)});`,context));
 const library=createBlockLibrary(result.state,'0.4.0'),merged=mergeBlockLibrary({blocks:{languageVersion:0,blocks:[]}},library);
 assert.equal(merged.blocks.blocks[0].inputs.STACK.block.inputs.VALUE.block.type,'ev3_reflected');
 for(const expression of result.expressions)assert.ok(compile({main:[{type:'set',var:'x',value:expression}],procedures:[]}).usesSensors);
});
test('fixed operator blocks keep numeric and Boolean meaning after saving and library import',()=>{
 const context=editor();
 const shapes=JSON.parse(vm.runInContext(`
 const category=toolbox.contents.find(c=>c.name==='演算'),results=[];
 for(const item of category.contents.filter(i=>i.type?.startsWith('ev3_op_'))){
  Blockly.serialization.workspaces.load({blocks:{languageVersion:0,blocks:[{type:'procedures_defnoreturn',fields:{NAME:'calculation'},inputs:{STACK:{block:{type:'variables_set',fields:{VAR:{id:'result'}},inputs:{VALUE:{block:{...item,kind:undefined,inputs:undefined}}}}}}}]},variables:[{id:'result',name:'result'}]},workspace);
  const b=workspace.getAllBlocks(false).find(b=>b.type===item.type),op=item.type.slice(7);
  for(const name of ['A','B']){const child=workspace.newBlock(['and','or'].includes(op)?'logic_boolean':'math_number');child.setFieldValue(['and','or'].includes(op)?'TRUE':name==='A'?8:2,['and','or'].includes(op)?'BOOL':'NUM');b.getInput(name).connection.connect(child.outputConnection);}
  results.push({op,state:Blockly.serialization.workspaces.save(workspace),expression:expression(b)});
 }
 JSON.stringify(results);`,context));
 assert.equal(shapes.length,12);
 for(const shape of shapes){
  const library=createBlockLibrary(shape.state,'0.4.8'),merged=mergeBlockLibrary({blocks:{languageVersion:0,blocks:[]}},library);
  assert.ok(JSON.stringify(merged).includes('ev3_op_'+shape.op));assert.equal(shape.expression.op,shape.op);
  assert.ok(compile({main:[{type:'set',var:'result',value:shape.expression}],procedures:[]}).data.length>28);
 }
});

test('continuous L/M motor blocks preserve port and variable speed through library reuse',()=>{
 const context=editor();
 const state=JSON.parse(vm.runInContext(`
 const model=workspace.getVariableMap().createVariable('速さ');const def=workspace.newBlock('procedures_defnoreturn');def.setFieldValue('回す','NAME');
 let tail=def.getInput('STACK').connection;
 for(const [type,port]of [['ev3_motor_l_run','6'],['ev3_motor_m_run','8']]){const b=workspace.newBlock(type);b.setFieldValue(port,'PORTS');const v=workspace.newBlock('variables_get');v.setFieldValue(model.getId(),'VAR');b.getInput('SPEED').connection.connect(v.outputConnection);tail.connect(b.previousConnection);tail=b.nextConnection;}
 JSON.stringify(Blockly.serialization.workspaces.save(workspace));`,context));
 const merged=mergeBlockLibrary({blocks:{languageVersion:0,blocks:[]}},createBlockLibrary(state,'0.4.1'));context.motorState=JSON.stringify(merged);
 const p=JSON.parse(vm.runInContext(`Blockly.serialization.workspaces.load(JSON.parse(motorState),workspace);const start=workspace.newBlock('ev3_start'),call=workspace.newBlock('procedures_callnoreturn');call.renameProcedure(call.getProcedureCall(),'回す');start.nextConnection.connect(call.previousConnection);JSON.stringify(program());`,context));
 assert.deepEqual(p.procedures[0].body.map(b=>[b.type,b.ports,b.speed.var]),[['motorRun',6,'速さ'],['motorRun',8,'速さ']]);assert.ok(compile(p).data.length>28);
});
test('distance-stop classroom sample compiles a continuous start followed by a sensor wait and stop',()=>{
 const context=editor();vm.runInContext('let dirty=false,loading=false;function saveLocal(){}function feedback(){}function check(){}',context);
 vm.runInContext(app.slice(app.indexOf("$('sensorMotorSample').onclick="),app.indexOf("$('colorSample').onclick=")),context);
 const p=JSON.parse(vm.runInContext("$('sensorMotorSample').onclick();const saved=Blockly.serialization.workspaces.save(workspace);Blockly.serialization.workspaces.load(saved,workspace);JSON.stringify(program());",context));
 assert.deepEqual(p.main.map(b=>b.type),['motorRun','while','stop']);assert.equal(p.main[0].ports,6);assert.equal(p.main[1].condition.left.sensor.port,4);assert.equal(p.main[1].condition.right,15);assert.equal(compile(p).usesSensors,true);
});

test('forever control block and default paired continuous motors survive save and library reuse',()=>{
 const context=editor();
 const state=JSON.parse(vm.runInContext(`
 const def=workspace.newBlock('procedures_defnoreturn');def.setFieldValue('ずっと走る','NAME');const loop=workspace.newBlock('ev3_forever');if(loop.nextConnection)throw Error('Forever should be terminal');def.getInput('STACK').connection.connect(loop.previousConnection);
 const run=workspace.newBlock('ev3_motor_l_run');if(run.getFieldValue('PORTS')!=='6')throw Error('Default must be B+C');loop.getInput('DO').connection.connect(run.previousConnection);const n=workspace.newBlock('math_number');n.setFieldValue(20,'NUM');run.getInput('SPEED').connection.connect(n.outputConnection);
 JSON.stringify(Blockly.serialization.workspaces.save(workspace));`,context));
 context.foreverState=JSON.stringify(mergeBlockLibrary({blocks:{languageVersion:0,blocks:[]}},createBlockLibrary(state,'0.4.2')));
 const p=JSON.parse(vm.runInContext(`Blockly.serialization.workspaces.load(JSON.parse(foreverState),workspace);const start=workspace.newBlock('ev3_start'),call=workspace.newBlock('procedures_callnoreturn');call.renameProcedure(call.getProcedureCall(),'ずっと走る');start.nextConnection.connect(call.previousConnection);JSON.stringify(program());`,context));
 assert.equal(p.procedures[0].body[0].type,'forever');assert.deepEqual(p.procedures[0].body[0].body,[{type:'motorRun',ports:6,speed:20}]);assert.ok(compile(p).data.length>28);
 assert.ok(vm.runInContext("toolbox.contents.find(c=>c.name==='制御').contents.some(b=>b.type==='ev3_forever')",context));
});

test('restyling old nested if/else lessons preserves conditions, statements and loop modes through mutation and reload',()=>{
 const context=editor();
 const n=value=>({block:{type:'math_number',fields:{NUM:value}}});
 const condition=value=>({block:{type:'logic_boolean',fields:{BOOL:value?'TRUE':'FALSE'}}});
 const tone=frequency=>({block:{type:'ev3_tone',fields:{VOLUME:25},inputs:{FREQUENCY:n(frequency),MS:n(100)}}});
 const branch={type:'controls_if',extraState:{elseIfCount:1,hasElse:true},inputs:{IF0:condition(false),DO0:tone(440),IF1:condition(true),DO1:tone(660),ELSE:tone(880)}};
 const state={blocks:{languageVersion:0,blocks:[{type:'ev3_start',next:{block:{type:'controls_repeat_ext',inputs:{TIMES:n(2),DO:{block:branch}},next:{block:{type:'controls_whileUntil',fields:{MODE:'WHILE'},inputs:{BOOL:condition(false),DO:tone(440)},next:{block:{type:'controls_whileUntil',fields:{MODE:'UNTIL'},inputs:{BOOL:condition(true),DO:tone(880)}}}}}}}}]}};
 context.oldControlState=JSON.stringify(state);
 const programs=JSON.parse(vm.runInContext(`
 Blockly.serialization.workspaces.load(JSON.parse(oldControlState),workspace);const before=program();
 const restoredIf=workspace.getAllBlocks(false).find(b=>b.type==='controls_if');restoredIf.rebuildShape_();
 const saved=Blockly.serialization.workspaces.save(workspace);Blockly.serialization.workspaces.load(saved,workspace);JSON.stringify([before,program()]);`,context));
 assert.deepEqual(programs[0],programs[1]);assert.equal(programs[1].main[0].body[0].else[0].then[0].frequency,660);assert.equal(programs[1].main[1].until,false);assert.equal(programs[1].main[2].until,true);assert.deepEqual(compile(programs[0]).data,compile(programs[1]).data);
});

test('all dropdown function choices survive Blockly save and My Block library reuse',()=>{
 const context=editor();
 const results=JSON.parse(vm.runInContext(`
 const def=workspace.newBlock('procedures_defnoreturn');def.setFieldValue('関数','NAME');const set=workspace.newBlock('variables_set'),model=workspace.getVariableMap().createVariable('結果');set.setFieldValue(model.getId(),'VAR');def.getInput('STACK').connection.connect(set.previousConnection);
 const fn=workspace.newBlock('ev3_math_function');set.getInput('VALUE').connection.connect(fn.outputConnection);const n=workspace.newBlock('math_number');n.setFieldValue(.5,'NUM');fn.getInput('VALUE').connection.connect(n.outputConnection);
 const results=numericFunctions.map(([,kind])=>{fn.setFieldValue(kind,'FUNCTION');return expression(fn);});
 JSON.stringify({results,state:Blockly.serialization.workspaces.save(workspace)});`,context));
 assert.equal(results.results.length,14);for(const value of results.results)assert.ok(compile({main:[{type:'set',var:'answer',value}],procedures:[]}).usesFloat);
 const library=createBlockLibrary(results.state,'0.5.0'),merged=mergeBlockLibrary({blocks:{languageVersion:0,blocks:[]}},library);context.unaryState=JSON.stringify(merged);
 const value=JSON.parse(vm.runInContext('Blockly.serialization.workspaces.load(JSON.parse(unaryState),workspace);JSON.stringify(expression(workspace.getAllBlocks(false).find(b=>b.type==="ev3_math_function")));',context));assert.deepEqual(value,{math:{fn:'pow10',value:.5}});
});

test('ordinary getters appear individually while shared set and change blocks retain variable dropdowns after reload',()=>{
 const context=editor();
 const result=JSON.parse(vm.runInContext(`
 Blockly.Events.disable();saveMyBlock(workspace,'移動',[{name:'引数の速さ'}]);
 const names=['回数','速度'];for(const name of names)createOrdinaryVariable(workspace,name);
 let rejected=0;for(const name of ['','回数','引数の速さ','x'.repeat(41)])try{createOrdinaryVariable(workspace,name);}catch{rejected++;}
 const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);
 const items=variableFlyout(workspace),blocks=items.filter(x=>x.kind==='block');
 const result={rejected,names:ordinaryVariables(workspace).map(m=>m.getName()),groups:blocks.map(item=>({type:item.type,name:workspace.getVariableMap().getVariableById(item.fields.VAR.id).getName()}))};
 for(const item of blocks){const block=Blockly.serialization.blocks.append(item,workspace);if(block.getField('VAR').getVariable().getName()!==workspace.getVariableMap().getVariableById(item.fields.VAR.id).getName())throw Error('Variable identity lost');}
 Blockly.Events.enable();JSON.stringify(result);
 `,context));
 assert.equal(result.rejected,4);assert.deepEqual(result.names,['回数','速度']);
 assert.deepEqual(result.groups,[{type:'variables_set',name:'回数'},{type:'math_change',name:'回数'},{type:'variables_get',name:'回数'},{type:'variables_get',name:'速度'}]);
 assert.match(app,/registerButtonCallback\('EV3_CREATE_VARIABLE',\(\)=>openVariableDialog\(\)\)/);
});

test('variable create button opens the form and submitted names refresh and persist the palette',()=>{
 const context=editor();
 vm.runInContext(`let dirty=false,refreshes=0,saves=0;workspace.refreshToolboxSelection=()=>refreshes++;function saveLocal(){saves++;}function feedback(){};for(const id of ['variableDialog','variableName','variableError','variableCancel','variableForm']){const el=$(id);el.showModal=()=>el.open=true;el.close=()=>el.open=false;el.focus=()=>{};}`,context);
 vm.runInContext(app.slice(app.indexOf('function openVariableDialog(){'),app.indexOf('// Classroom layout:')),context);
 vm.runInContext(`let buttonCallback;workspace.registerButtonCallback=(key,cb)=>{buttonCallback=cb;};`,context);
 const registration=app.match(/workspace\.registerButtonCallback\('EV3_CREATE_VARIABLE'.*?;/)[0];vm.runInContext(registration,context);
 assert.equal(vm.runInContext(`buttonCallback({getTargetWorkspace:()=>workspace});$('variableDialog').open;`,context),true);
 assert.equal(vm.runInContext(`$('variableName').value='試行回数';$('variableForm').onsubmit({preventDefault(){}});ordinaryVariables(workspace)[0].getName();`,context),'試行回数');
 assert.equal(vm.runInContext(`saves===1&&refreshes===1&&dirty&&!$('variableDialog').open;`,context),true);
 assert.equal(vm.runInContext(`buttonCallback({});$('variableName').value='試行回数';$('variableForm').onsubmit({preventDefault(){}});$('variableDialog').open&&saves===1&&$('variableError').textContent.includes('同じ名前');`,context),true);
});

test('ramp Blockly settings and the comparison sample save, reload and export inside My Blocks',()=>{
 const context=editor();vm.runInContext(app.slice(app.indexOf('function rampSampleState(){'),app.indexOf("function loadRampSample(){")),context);
 const sample=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(rampSampleState(),workspace);const sampleSaved=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(sampleSaved,workspace);const sampleParsed=program();Blockly.Events.enable();JSON.stringify(sampleParsed);`,context));
 assert.deepEqual(sample.main.filter(x=>x.type==='ramp').map(x=>x.mode),['trapezoid','scurve']);assert.equal(sample.main.filter(x=>x.type==='motor').length,2);assert.ok(compile(sample).usesRamps);
 const lesson=vm.runInContext(`Blockly.Events.disable();workspace.clear();const def=saveMyBlock(workspace,'加減速設定',[{name:'時間'}]);const setting=workspace.newBlock('ev3_ramp');setting.setFieldValue('scurve','MODE');def.getInput('STACK').connection.connect(setting.previousConnection);const arg=workspace.newBlock('ev3_argument');arg.loadExtraState({parameterId:def.getVarModels()[0].getId(),name:'時間'});setting.getInput('UP').connection.connect(arg.outputConnection);const n=workspace.newBlock('math_number');n.setFieldValue(.5,'NUM');setting.getInput('DOWN').connection.connect(n.outputConnection);const saved=Blockly.serialization.workspaces.save(workspace);Blockly.Events.enable();JSON.stringify(saved);`,context);
 const merged=mergeBlockLibrary({blocks:{languageVersion:0,blocks:[{type:'ev3_start'}]}},createBlockLibrary(JSON.parse(lesson),'0.9.0'));context.lesson=JSON.stringify(merged);
 const p=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(lesson),workspace);const start=workspace.getAllBlocks(false).find(b=>b.type==='ev3_start'),call=workspace.newBlock('procedures_callnoreturn');call.loadExtraState({name:'加減速設定',params:['時間']});start.nextConnection.connect(call.previousConnection);ensureArgumentInputs();call.getInputTargetBlock('ARG0').setFieldValue(1,'NUM');const p=program();Blockly.Events.enable();JSON.stringify(p);`,context));
 assert.deepEqual(p.procedures[0].body[0],{type:'ramp',mode:'scurve',upSeconds:{param:'時間'},downSeconds:.5});assert.ok(compile(p).usesRamps);
});

test('both pivot Blockly blocks retain motor ports and argument angles through project and My Block library reuse',()=>{
 for(const direction of ['left','right']){
  const context=editor();context.pivotDirection=direction;
  const saved=vm.runInContext(`Blockly.Events.disable();const def=saveMyBlock(workspace,'片輪旋回',[{name:'角度'}]);const wheel=workspace.newBlock('ev3_wheel'),tread=workspace.newBlock('ev3_tread'),turn=workspace.newBlock('ev3_pivot_'+pivotDirection);def.getInput('STACK').connection.connect(wheel.previousConnection);wheel.nextConnection.connect(tread.previousConnection);tread.nextConnection.connect(turn.previousConnection);turn.setFieldValue('8','LEFT_PORT');turn.setFieldValue('1','RIGHT_PORT');const argument=workspace.newBlock('ev3_argument');argument.loadExtraState({parameterId:def.getVarModels()[0].getId(),name:'角度'});turn.getInput('ANGLE').connection.connect(argument.outputConnection);const speed=workspace.newBlock('math_number');speed.setFieldValue(20,'NUM');turn.getInput('SPEED').connection.connect(speed.outputConnection);const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);const exported=Blockly.serialization.workspaces.save(workspace);Blockly.Events.enable();JSON.stringify(exported);`,context);
  context.pivotLesson=JSON.stringify(mergeBlockLibrary({blocks:{languageVersion:0,blocks:[{type:'ev3_start'}]}},createBlockLibrary(JSON.parse(saved),'0.10.0')));
  const p=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(pivotLesson),workspace);const start=workspace.getAllBlocks(false).find(b=>b.type==='ev3_start'),call=workspace.newBlock('procedures_callnoreturn');call.loadExtraState({name:'片輪旋回',params:['角度']});start.nextConnection.connect(call.previousConnection);ensureArgumentInputs();call.getInputTargetBlock('ARG0').setFieldValue(90,'NUM');const p=program();Blockly.Events.enable();JSON.stringify(p);`,context));
  assert.deepEqual(p.procedures[0].body[2],{type:'pivot',leftPort:8,rightPort:1,speed:20,angle:{param:'角度'},direction});assert.ok(compile(p).data.length>28);
 }
});

test('independent left/right speed block survives save, reload and My Block library reuse',()=>{
 const context=editor();const saved=vm.runInContext(`Blockly.Events.disable();const def=saveMyBlock(workspace,'左右の速さ',[]),block=workspace.newBlock('ev3_tank');def.getInput('STACK').connection.connect(block.previousConnection);block.setFieldValue('8','LEFT_PORT');block.setFieldValue('1','RIGHT_PORT');for(const [name,value]of [['LEFT_SPEED',-100],['RIGHT_SPEED',50]]){const n=workspace.newBlock('math_number');n.setFieldValue(value,'NUM');block.getInput(name).connection.connect(n.outputConnection);}const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);const saved=Blockly.serialization.workspaces.save(workspace);Blockly.Events.enable();JSON.stringify(saved);`,context);
 context.tankLesson=JSON.stringify(mergeBlockLibrary({blocks:{languageVersion:0,blocks:[{type:'ev3_start'}]}},createBlockLibrary(JSON.parse(saved),'0.11.0')));
 const p=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(tankLesson),workspace);const start=workspace.getAllBlocks(false).find(b=>b.type==='ev3_start'),call=workspace.newBlock('procedures_callnoreturn');call.loadExtraState({name:'左右の速さ',params:[]});start.nextConnection.connect(call.previousConnection);const p=program();Blockly.Events.enable();JSON.stringify(p);`,context));assert.deepEqual(p.procedures[0].body[0],{type:'tank',leftPort:8,rightPort:1,leftSpeed:-100,rightSpeed:50});assert.ok(compile(p).data.length>28);
});


test('timer blocks survive project reload and My Block export/import and compile a fractional wait condition',()=>{
 const context=editor();const saved=vm.runInContext(`Blockly.Events.disable();const def=saveMyBlock(workspace,'時間で待つ',[]),reset=workspace.newBlock('ev3_timer_reset'),wait=workspace.newBlock('ev3_wait_until'),compare=workspace.newBlock('ev3_op_gte'),clock=workspace.newBlock('ev3_timer'),limit=workspace.newBlock('math_number');limit.setFieldValue(.5,'NUM');compare.getInput('A').connection.connect(clock.outputConnection);compare.getInput('B').connection.connect(limit.outputConnection);wait.getInput('BOOL').connection.connect(compare.outputConnection);def.getInput('STACK').connection.connect(reset.previousConnection);reset.nextConnection.connect(wait.previousConnection);const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);const saved=Blockly.serialization.workspaces.save(workspace);Blockly.Events.enable();JSON.stringify(saved);`,context);
 const library=createBlockLibrary(JSON.parse(saved),'0.12.0');context.timerLesson=JSON.stringify(mergeBlockLibrary({blocks:{languageVersion:0,blocks:[{type:'ev3_start'}]}},library));
 const p=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(timerLesson),workspace);const start=workspace.getAllBlocks(false).find(b=>b.type==='ev3_start'),call=workspace.newBlock('procedures_callnoreturn');call.loadExtraState({name:'時間で待つ',params:[]});start.nextConnection.connect(call.previousConnection);const p=program();Blockly.Events.enable();JSON.stringify(p);`,context));
 assert.deepEqual(p.procedures[0].body,[{type:'timerReset'},{type:'while',until:true,condition:{op:'gte',left:{timer:true},right:.5},body:[]}]);assert.equal(compile(p).usesTimer,true);
});

test('new classroom data and steering samples reload, preserve library types and compile into native images',()=>{
 for(const name of ['DataLogTest','SteeringTest']){
  const context=editor(),saved=JSON.parse(readFileSync(new URL('../examples/'+name+'.ev3lab',import.meta.url),'utf8'));inspectBlocks(saved.workspace.blocks);context.newSample=JSON.stringify(saved.workspace);
  const parsed=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(newSample),workspace);const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);const p=program();Blockly.Events.enable();JSON.stringify(p);`,context));
  const build=compile(parsed);assert.ok(build.data.length<65536);if(name==='DataLogTest')assert.deepEqual(build.logFiles,['Log']);else assert.equal(parsed.main.filter(x=>x.type==='steering').length,2);
 }
});
test('every newly advertised data block can be saved and restored through the actual allowlist',()=>{
 const context=editor(),saved=JSON.parse(vm.runInContext(`Blockly.Events.disable();const groups=toolbox.contents.filter(c=>['データ','記録','ランプ'].includes(c.name));for(const item of groups.flatMap(c=>c.contents).filter(x=>x.kind==='block'))Blockly.serialization.blocks.append(item,workspace);const state=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(state,workspace);const result=Blockly.serialization.workspaces.save(workspace);Blockly.Events.enable();JSON.stringify(result);`,context));inspectBlocks(saved.blocks);assert.ok(saved.blocks.blocks.length>=20);
});

test('parallel startup and event hats survive project reload with sensor conditions and message names',()=>{
 const context=editor();
 const result=JSON.parse(vm.runInContext(`
 Blockly.Events.disable();
 const state={blocks:{languageVersion:0,blocks:[
 {type:'ev3_start',next:{block:{type:'ev3_message_wait',fields:{MESSAGE:'走行開始'}}}},
 {type:'ev3_start',next:{block:{type:'ev3_wait_seconds',inputs:{SECONDS:{shadow:{type:'math_number',fields:{NUM:1}}}}}}},
 {type:'ev3_when_message',fields:{MESSAGE:'走行開始'},next:{block:{type:'ev3_stop'}}},
 {type:'ev3_when_condition',inputs:{BOOL:{block:{type:'ev3_touch',fields:{PORT:'1',STATE:'1'}}}},next:{block:{type:'ev3_program_end'}}},
 {type:'ev3_when_changed',inputs:{VALUE:{block:{type:'ev3_color_value',fields:{PORT:'3'}}}},next:{block:{type:'ev3_led'}}}
 ]}};
 Blockly.serialization.workspaces.load(state,workspace);const saved=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(saved,workspace);
 const p=program();const blocks=Blockly.serialization.workspaces.save(workspace);Blockly.Events.enable();JSON.stringify({p,blocks});`,context));
 inspectBlocks(result.blocks.blocks);const build=compile(result.p);assert.equal(build.threadCount,5);assert.equal(build.usesParallel,true);
 assert.equal(result.p.main[0].type,'broadcast');assert.equal(result.p.main[0].wait,true);
 assert.deepEqual(result.p.threads.map(t=>t.kind),['start','message','condition','changed']);
 assert.equal(result.p.threads[1].message,'走行開始');
});

test('messages in a reusable My Block preserve export/import semantics and same named arguments',()=>{
 const context=editor();const library=JSON.parse(vm.runInContext(`Blockly.Events.disable();const def=saveMyBlock(workspace,'通知する',[]),send=workspace.newBlock('ev3_message_send');send.setFieldValue('できた','MESSAGE');def.getInput('STACK').connection.connect(send.previousConnection);const state=Blockly.serialization.workspaces.save(workspace);Blockly.Events.enable();JSON.stringify(state);`,context));
 const merged=mergeBlockLibrary({blocks:{languageVersion:0,blocks:[{type:'ev3_start'}]}},createBlockLibrary(library,'0.18.0'));inspectBlocks(merged.blocks);
 assert.equal(merged.blocks.blocks.find(b=>b.type==='procedures_defnoreturn').inputs.STACK.block.fields.MESSAGE,'できた');
});

test('all three parallel classroom samples reload and compile without losing events, variables or log names',()=>{
 for(const [kind,name]of [['parallel','ParallelMeasure'],['event','TouchEvent'],['message','MessageRelay']]){
  const context=editor(),sample=JSON.parse(readFileSync(new URL('../examples/'+name+'.ev3lab',import.meta.url),'utf8'));
  inspectBlocks(sample.workspace.blocks);context.lesson=JSON.stringify(sample.workspace);context.kind=kind;
  const p=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(lesson),workspace);const saved=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(saved,workspace);const p=program();Blockly.Events.enable();JSON.stringify(p);`,context));
  const b=compile(p);assert.equal(b.threadCount,2);assert.ok(b.usesParallel);assert.equal(b.program.procedures.length,0);
  assert.deepEqual(b.logFiles,kind==='parallel'?['Parallel']:kind==='message'?['Message']:[]);
  const generated=JSON.parse(vm.runInContext('JSON.stringify(parallelSampleState(kind))',context));assert.deepEqual(generated,sample.workspace);
 }
});
