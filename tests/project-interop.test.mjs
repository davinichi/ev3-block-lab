import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {convertProject} from '../dist/project-interop.js';
import {inspectBlocks} from '../dist/library.js';
import {compile} from '../dist/ev3.js';
import {editor} from './helpers/interop-editor.mjs';
import {sharedProject,mixedProject} from './project-interop-fixtures.js';
test('SBL common blocks load in the real EBL editor, preserve data, compile and reload',()=>{
 const source=sharedProject(),before=structuredClone(source),report=convertProject(source,'ebl','Common.spikelab');assert.equal(report.unsupported.length,0);inspectBlocks(report.project.workspace.blocks);
 const c=editor();c.lesson=JSON.stringify(report.project.workspace);
 const result=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(lesson),workspace);const saved=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(saved,workspace);ensureArgumentInputs();JSON.stringify({saved,program:program()});`,c));
 assert.ok(compile(result.program).data.length);assert.deepEqual(source,before);
 const returnProject=convertProject({...report.project,workspace:result.saved},'sbl');assert.equal(returnProject.unsupported.length,0);
 const body=result.program.procedures.find(p=>p.name==='合図').body;assert.equal(body[0].type,'tone');
 assert.equal(result.program.main.filter(b=>b.type==='call').length,2);
});
test('unsupported SBL motors and sensors stay visible and intact after saving; disabled and disconnected placeholders still block generation',()=>{
 const source=mixedProject(),report=convertProject(source,'ebl');assert.equal(report.unsupported.length,2);inspectBlocks(report.project.workspace.blocks);
 const c=editor();c.lesson=JSON.stringify(report.project.workspace);
 const saved=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(lesson),workspace);const saved=Blockly.serialization.workspaces.save(workspace);workspace.clear();Blockly.serialization.workspaces.load(saved,workspace);JSON.stringify(saved);`,c));
 assert.throws(()=>vm.runInContext('program()',c),/変換できない/);
 vm.runInContext(`workspace.getAllBlocks(false).filter(b=>b.type==='blocklab_unconverted').forEach(b=>{b.setDisabledReason(true,'test');b.unplug();});`,c);
 assert.throws(()=>vm.runInContext('program()',c),/変換できない/);
 const restored=convertProject({...report.project,workspace:saved},'sbl');
 const motor=restored.project.workspace.blocks.blocks[0].next.block;assert.equal(motor.type,'lab_motor_absolute');assert.equal(motor.inputs.POSITION.shadow.fields.NUM,360);
 assert.deepEqual(report.project.importedFrom.original,source);
});
test('up to eight named results retain their selectors and target-variable IDs',()=>{
 const source=sharedProject(),outputs=Array.from({length:8},(_,i)=>'値'+i);
 source.workspace.blocks.blocks.push({type:'lab_call_outputs',id:'eight-results',extraState:{name:'八つ',params:[],outputs},fields:Object.fromEntries(outputs.map((n,i)=>['OUT'+i,{id:'result-'+i,name:n}]))});
 source.workspace.variables.push(...outputs.map((name,i)=>({name,id:'result-'+i})));
 source.workspace.blocks.blocks.push({type:'procedures_defreturn',fields:{NAME:'八つ'},extraState:{params:[],outputs},inputs:Object.fromEntries(outputs.map((_,i)=>[i?'RETURN'+i:'RETURN',{shadow:{type:'math_number',fields:{NUM:i}}}]))});
 const report=convertProject(source,'ebl');inspectBlocks(report.project.workspace.blocks);const c=editor();c.lesson=JSON.stringify(report.project.workspace);
 const saved=JSON.parse(vm.runInContext(`Blockly.Events.disable();Blockly.serialization.workspaces.load(JSON.parse(lesson),workspace);JSON.stringify(Blockly.serialization.workspaces.save(workspace));`,c));
 const call=saved.blocks.blocks.find(b=>b.id==='eight-results');assert.deepEqual(call.extraState.outputs,outputs);for(let i=0;i<8;i++)assert.equal(call.fields['OUT'+i].id,'result-'+i);
});
