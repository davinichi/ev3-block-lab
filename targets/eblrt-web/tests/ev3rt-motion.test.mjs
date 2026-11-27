import {expandedSource} from './ev3rt-source.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportEV3RT} from '../dist/ev3rt.js';
import {compile} from '../dist/ev3.js';
const setup=[{type:'movementSetup',leftPort:2,rightPort:4},{type:'wheel',diameter:56},{type:'tread',mm:112}];
const program=body=>({main:[...setup,...body],procedures:[]});
export const movementProgram=program([
 {type:'ramp',mode:'trapezoid',upSeconds:.1,downSeconds:.1},
 {type:'drive',movement:true,speed:20,cm:10,direction:'forward',mode:'independent'},
 {type:'drive',movement:true,speed:-20,cm:10,direction:'backward',mode:'sync'},
 ...['spin','pivot'].flatMap(type=>['right','left'].map(direction=>({type,movement:true,speed:20,angle:90,direction}))),
 {type:'steering',movement:true,action:'run',turn:20,speed:20},
 {type:'steering',movement:true,action:'angle',turn:-100,speed:20,degrees:180},
 {type:'steering',movement:true,action:'time',turn:50,speed:20,seconds:.2},
 {type:'tank',movement:true,leftSpeed:20,rightSpeed:-20},
 {type:'tankFinite',movement:true,action:'angle',leftSpeed:20,rightSpeed:-10,degrees:90},
 {type:'tankFinite',movement:true,action:'time',leftSpeed:-20,rightSpeed:10,seconds:.2},
 {type:'stop',movement:true,stopMode:'brake'},
 {type:'ramp',mode:'scurve',upSeconds:.1,downSeconds:.1},
 {type:'spin',movement:true,speed:-20,angle:90,direction:'right'},
 {type:'ramp',mode:'off',upSeconds:0,downSeconds:0}
]);
test('all Movement block forms emit native synchronized steering with finite completion',()=>{
 const c=expandedSource(exportEV3RT(movementProgram));
 for(const s of ['lab_pair_setup(1, 2);','lab_geometry(0,','lab_geometry(1,','lab_geometry(2,','lab_steering(100,','lab_steering(-100,','lab_steering(50,','lab_steering(-50,','lab_tank(','lab_stop_selected(lab_movement_mask(), 0);','lab_ramp(2,','ev3_motor_steer('])assert.ok(c.includes(s),s);
 assert.match(c,/ev3_motor_config\(EV3_PORT_B, LARGE_MOTOR\)/);
 assert.match(c,/ev3_motor_config\(EV3_PORT_C, LARGE_MOTOR\)/);
});
test('movement dimensions and wiring remain required and branch-ordered',()=>{
 const spin={type:'spin',movement:true,speed:20,angle:90,direction:'right'};
 assert.throws(()=>exportEV3RT({main:[spin],procedures:[]}),/設定/);
 assert.throws(()=>exportEV3RT({main:[setup[0],spin],procedures:[]}),/直径/);
 assert.throws(()=>exportEV3RT({main:[setup[0],setup[1],spin],procedures:[]}),/トレッド/);
 assert.throws(()=>exportEV3RT({main:[{...setup[0],rightPort:2},spin],procedures:[]}),/異なる/);
});
test('all 12 logical pair orders are configured without assuming B+C',()=>{
 for(const leftPort of [1,2,4,8])for(const rightPort of [1,2,4,8])if(leftPort!==rightPort){
  const p=program([{type:'spin',movement:true,speed:-20,angle:90,direction:'left'}]);p.main[0]={type:'movementSetup',leftPort,rightPort};
  const c=exportEV3RT(p).files['EV3Lab/app.c'];assert.ok(c.includes('lab_pair_setup('+Math.log2(leftPort)+', '+Math.log2(rightPort)+');'));
 }
});
test('movement in My Blocks uses shared runtime settings and keeps RBF generation unchanged',()=>{
 const p={main:[...setup,{type:'call',name:'turn',args:[90]}],procedures:[{name:'turn',params:['degrees'],body:[{type:'pivot',movement:true,speed:20,angle:{param:'degrees'},direction:'right'}]}]};
 const before=compile(p).data,snapshot=JSON.stringify(p);exportEV3RT(p);assert.deepEqual(compile(p).data,before);assert.equal(JSON.stringify(p),snapshot);
});
test('two-motor sync and generated completion feedback are distinct supported modes',()=>{
 const b={type:'motor',ports:6,speed:20,degrees:180,mode:'sync'};
 assert.match(exportEV3RT({main:[b],procedures:[]}).files['EV3Lab/app.c'],/lab_motion\(1, 2,/);
 assert.match(exportEV3RT({main:[{...b,mode:'feedback'}],procedures:[]}).files['EV3Lab/app.c'],/lab_finite\(6, [^\n]+, 0, 1\);/);
});
test('ramps cannot be silently ignored by independent finite motor blocks',()=>{
 const ramp={type:'ramp',mode:'trapezoid',upSeconds:.1,downSeconds:.1};
 for(const b of [{type:'motor',ports:2,speed:20,degrees:90,mode:'independent'},{type:'motorTimed',ports:2,speed:20,seconds:.1}])assert.match(exportEV3RT({main:[ramp,b],procedures:[]}).files['EV3Lab/app.c'],/lab_finite\(2,/);
});
