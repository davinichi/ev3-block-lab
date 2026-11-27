import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportEV3RT} from '../dist/ev3rt.js';
const ramp=mode=>({type:'ramp',mode,upSeconds:.5,downSeconds:.5});
const arm={name:'arm',params:['speed','seconds'],body:[{type:'motorTimed',ports:8,speed:{param:'speed'},seconds:{param:'seconds'}}]};
const call=name=>({type:'call',name,args:[]});
const armCall={type:'call',name:'arm',args:[10,1]};
const setup=[{type:'movementSetup',leftPort:2,rightPort:4},{type:'wheel',diameter:56},{type:'tread',mm:126}];
export const userProgram={main:[...setup,{type:'call',name:'forward',args:[50,50]},{type:'call',name:'turn_left',args:[50,90]},{type:'call',name:'turn_right',args:[50,90]},armCall,{...armCall,args:[20,1]},{type:'call',name:'backward',args:[50,50]}],procedures:[
 ...['forward','backward'].map(name=>({name,params:['speed','distance'],body:[ramp('scurve'),{type:'drive',movement:true,direction:name==='forward'?'forward':'backward',mode:'independent',speed:{param:'speed'},cm:{param:'distance'}},{type:'stop',movement:true,stopMode:'brake'},ramp('off')]})),
 ...['left','right'].map(direction=>({name:'turn_'+direction,params:['speed','degrees'],body:[ramp('scurve'),{type:'spin',movement:true,direction,speed:{param:'speed'},angle:{param:'degrees'}},{type:'stop',movement:true,stopMode:'brake'},ramp('off')]})),arm
]};
test('screenshot program can mix ramped driving My Blocks with unramped M motor My Block',()=>{
 const files=exportEV3RT(userProgram,{motorTypes:{D:'medium'}}).files;
 const c=files['EV3Lab/app.c']+files['EV3Lab/ebl_myblocks.c'];
 assert.match(c,/ev3_motor_config\(EV3_PORT_D, MEDIUM_MOTOR\)/);
 assert.match(c,/lab_finite\(8,/);
});
test('ramp off before a direct motor or before a My Block is accepted in execution order',()=>{
 for(const body of [[ramp('scurve'),ramp('off'),{type:'motorTimed',ports:8,speed:10,seconds:1}],[ramp('scurve'),ramp('off'),armCall]])assert.doesNotThrow(()=>exportEV3RT({main:body,procedures:[arm]}));
});
test('ramp on inherited by a called M motor is supported',()=>{
 assert.doesNotThrow(()=>exportEV3RT({main:[ramp('scurve'),armCall],procedures:[arm]}));
});
test('a My Block can return with its ramp setting active',()=>{
 const p={main:[ramp('scurve'),call('reset'),armCall],procedures:[arm,{name:'reset',params:[],body:[{type:'myblockReturn'},ramp('off')]}]};
 assert.doesNotThrow(()=>exportEV3RT(p));
});
test('ramps selected in branches and repeated loops are valid for finite motors',()=>{
 const motor={type:'motorTimed',ports:8,speed:10,seconds:1};
 assert.doesNotThrow(()=>exportEV3RT({main:[{type:'if',condition:{var:'x'},then:[ramp('scurve')],else:[]},motor],procedures:[]}));
 assert.doesNotThrow(()=>exportEV3RT({main:[{type:'repeat',count:2,body:[motor,ramp('scurve')]}],procedures:[]}));
 assert.doesNotThrow(()=>exportEV3RT({main:[{type:'repeat',count:0,body:[ramp('scurve')]},motor],procedures:[]}));
});
test('numeric My Block expressions apply ramp changes before the motor call',()=>{
 const reset={name:'reset',params:[],returns:true,result:10,body:[ramp('off')]};
 assert.doesNotThrow(()=>exportEV3RT({main:[ramp('scurve'),{...armCall,args:[{callValue:{name:'reset',args:[]}},1]}],procedures:[arm,reset]}));
});
