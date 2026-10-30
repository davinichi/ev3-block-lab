import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBlockLibrary,mergeBlockLibrary} from '../dist/library.js';
function source(){
 const argument={id:'arg',type:'ev3_argument',fields:{ARG_NAME:'距離'},extraState:{parameterId:'param',name:'距離'}};
 const increment={type:'math_change',fields:{VAR:{id:'count'}},inputs:{DELTA:{block:{type:'math_number',fields:{NUM:1}}}}};
 const first={id:'first',type:'procedures_defnoreturn',fields:{NAME:'前進'},extraState:{params:[{id:'param',name:'距離'}]},inputs:{STACK:{block:argument}}};
 const second={id:'second',type:'procedures_defnoreturn',fields:{NAME:'数える'},inputs:{STACK:{block:increment}}};
 return {variables:[{id:'param',name:'距離'},{id:'count',name:'回数'},{id:'unused',name:'実験用'}],blocks:{languageVersion:0,blocks:[{id:'start',type:'ev3_start'},first,second]}};
}
test('library export contains definitions and their referenced variables only',()=>{
 const state=source(),library=createBlockLibrary(state,'0.3.0');
 assert.equal(library.definitions.length,2);assert.deepEqual(library.variables.map(v=>v.name),['距離','回数']);assert.ok(!library.definitions.some(b=>b.type==='ev3_start'));
 library.definitions[0].fields.NAME='changed';assert.equal(state.blocks.blocks[1].fields.NAME,'前進');
});
test('library import preserves the project, remaps parameter IDs and shares matching normal variables',()=>{
 const current={variables:[{id:'param',name:'別の変数'},{id:'existing-count',name:'回数'}],blocks:{languageVersion:0,blocks:[{type:'ev3_start',id:'keep',x:10,y:20}]}};
 const library=createBlockLibrary(source(),'0.3.0');let id=0;
 const merged=mergeBlockLibrary(current,library,()=>`fresh-${++id}`);
 assert.equal(merged.blocks.blocks[0].id,'keep');assert.equal(current.blocks.blocks.length,1);
 const def=merged.blocks.blocks[1],param=def.extraState.params[0].id;
 assert.equal(param,'fresh-1');assert.equal(def.inputs.STACK.block.extraState.parameterId,param);assert.equal(def.id,undefined);assert.equal(def.inputs.STACK.block.id,undefined);
 assert.equal(merged.blocks.blocks[2].inputs.STACK.block.fields.VAR.id,'existing-count');assert.equal(merged.variables.find(v=>v.id==='param').name,'別の変数');
});
test('invalid or conflicting imports are rejected without changing the target',()=>{
 const current=source(),before=structuredClone(current),library=createBlockLibrary(source(),'0.3.0');
 assert.throws(()=>mergeBlockLibrary(current,library),/同じ名前/);assert.deepEqual(current,before);
 assert.throws(()=>mergeBlockLibrary({}, {...library,format:'wrong'}),/ファイル/);
 const missing=structuredClone(library);missing.variables=[];assert.throws(()=>mergeBlockLibrary({},missing),/情報が不足/);
 const unknown=structuredClone(library);unknown.definitions[0].inputs.STACK.block.type='script';assert.throws(()=>mergeBlockLibrary({},unknown),/未対応/);
});
