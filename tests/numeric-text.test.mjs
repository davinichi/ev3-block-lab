import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {halfWidthNumberText,installNumericTextNormalization} from '../dist/numeric-text.js';
function fixture(){
 const c=vm.createContext({console,setTimeout,clearTimeout});for(const file of ['blockly_compressed.js','blocks_compressed.js'])vm.runInContext(readFileSync(new URL('../dist/vendor/'+file,import.meta.url),'utf8'),c);
 const Blockly=c.Blockly,events=new Map(),notice={hidden:true,textContent:''},jobs=new Map();let next=0;
 const document={defaultView:{Event:class{constructor(type){this.type=type}}},addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:type=>events.delete(type)};
 const input={value:'',selectionStart:0,selectionEnd:0,setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},dispatchEvent(){field.setValue(field.getValueFromEditorText_(input.value));}};
 const field=new Blockly.FieldNumber(0,-100,100);field.htmlInput_=input;
 const dispose=installNumericTextNormalization(Blockly,{document,notice,setTimer:fn=>{jobs.set(++next,fn);return next;},clearTimer:id=>jobs.delete(id)});
 return {Blockly,field,input,notice,jobs,events,dispose,enter(text){input.value=text;input.dispatchEvent();}};
}
test('number normalization covers full-width digits, minus and point without translating Japanese text',()=>{
 assert.equal(halfWidthNumberText('－１２．５'),'-12.5');assert.equal(halfWidthNumberText('−８０'),'-80');assert.equal(halfWidthNumberText('０１２３４５６７８９'),'0123456789');assert.equal(halfWidthNumberText('18.5'),'18.5');assert.equal(halfWidthNumberText('名前ー。'),'名前ー。');
});
test('real bundled Blockly number validation keeps ranges and text fields while notifying once',()=>{
 const f=fixture();try{f.enter('－１２．５');assert.equal(f.field.getValue(),-12.5);assert.equal(f.input.value,'-12.5');assert.equal(f.notice.textContent,'半角に直しました');f.enter('９９９');assert.equal(f.field.getValue(),100);assert.equal(f.jobs.size,1);const text=new f.Blockly.FieldTextInput('名前１２');assert.equal(text.getValue(),'名前１２');for(const fn of f.jobs.values())fn();assert.equal(f.notice.hidden,true);}finally{f.dispose();}
});
test('IME input stays untouched until composition ends; saved block values remain numeric',()=>{
 const f=fixture();try{f.events.get('compositionstart')({target:f.input});f.enter('－８．５');assert.equal(f.input.value,'－８．５');assert.equal(f.notice.hidden,true);f.events.get('compositionend')({target:f.input});assert.equal(f.input.value,'-8.5');assert.equal(f.field.getValue(),-8.5);const w=new f.Blockly.Workspace(),again=new f.Blockly.Workspace();try{const b=w.newBlock('math_number');b.setFieldValue(f.field.getValue(),'NUM');f.Blockly.serialization.workspaces.load(f.Blockly.serialization.workspaces.save(w),again);assert.equal(again.getAllBlocks(false)[0].getFieldValue('NUM'),-8.5);}finally{w.dispose();again.dispose();}}finally{f.dispose();}
});
test('page and language bootstrap load normalization and provide an independent accessible notice',()=>{
 const page=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');assert.match(page,/id="numberInputNotice"[^>]*role="status"/);assert.match(app,/installNumericTextNormalization\(Blockly/);assert.match(app,/message:\(\)=>uiText/);assert.match(readFileSync(new URL('../dist/locale-en.js',import.meta.url),'utf8'),/Converted to half-width characters/);
});
