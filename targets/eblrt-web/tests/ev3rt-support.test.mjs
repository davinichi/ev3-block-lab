import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blockSupport} from '../dist/ev3rt-support.js';
import {exportEV3RT} from '../dist/ev3rt.js';
test('support catalogue agrees with newly supported features and public API constraints',()=>{
 assert.equal(blockSupport('ev3_led',{MODE:'pulse'}).status,'unsupported');
 assert.throws(()=>exportEV3RT({main:[{type:'led',color:1,mode:'pulse'}],procedures:[]}),/公開API/);
 for(const mode of ['on','flash']){assert.equal(blockSupport('ev3_led',{MODE:mode}).status,'supported');assert.doesNotThrow(()=>exportEV3RT({main:[{type:'led',color:1,mode}],procedures:[]}));}
 for(const type of ['ev3_text_join','ev3_list_add','ev3_log_start','ev3_pid','ev3_data_random','ev3_brick_button','ev3_ir_remote','ev3_ir_beacon_distance','ev3_display_number'])assert.equal(blockSupport(type).status,'supported',type);
 assert.equal(blockSupport('ev3_new_unknown_block').known,false);
});

test('motor constraints distinguish raw M power from supported generated controllers',()=>{
 assert.throws(()=>exportEV3RT({main:[{type:'motorPower',ports:8,speed:20}],procedures:[]},{motorTypes:{D:'medium'}}),/Mモーター/);
 assert.doesNotThrow(()=>exportEV3RT({main:[{type:'stop',ports:8,stopMode:'hold'}],procedures:[]}));
 for(const type of ['ev3_ramp','ev3_motor_stop_mode','ev3_motor_stop','ev3_spin_left','ev3_motor_m_pair_time','ev3_motor_speed'])assert.equal(blockSupport(type).status,'supported');
});
