import {expandedSource} from './ev3rt-source.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportEV3RT} from '../dist/ev3rt.js';
import {sourceZip} from '../dist/source-zip.js';
import {compile} from '../dist/ev3.js';

export const sample={main:[
  {type:'set',var:'回数/*',value:2.5},
  {type:'repeat',count:2,body:[{type:'call',name:'音を鳴らす',args:[440]}]},
  {type:'motorRun',ports:2,speed:20},
  {type:'waitSeconds',seconds:.25},
  {type:'stop',ports:2,stopMode:'coast'},
  {type:'motor',ports:6,speed:-20,degrees:90,mode:'independent'},
  {type:'motorTimed',ports:4,speed:20,seconds:1},
  {type:'set',var:'距離',value:{sensor:{kind:'distance',port:1}}},
  {type:'if',condition:{op:'lt',left:{var:'距離'},right:20},then:[{type:'led',color:1,mode:'on'}],else:[]},
  {type:'callOutputs',name:'計算',args:[3],targets:['値','値2']},
  {type:'set',var:'値3',value:{callValue:{name:'計算',args:[5],output:1}}},
  {type:'while',until:true,condition:{sensor:{kind:'touch',port:2}},body:[]},
  {type:'gyroReset',port:3},
  {type:'set',var:'角度',value:{sensor:{kind:'gyroAngle',port:3}}},
  {type:'displayBitmap',x:1,y:2,bitmap:{width:2,height:2,rows:['10','01']}},
  {type:'displayClear'},
  {type:'timerReset'},
  {type:'set',var:'時間',value:{timer:true}},
  {type:'programEnd'}
],procedures:[
  {name:'音を鳴らす',params:['周波数'],body:[{type:'tone',frequency:{param:'周波数'},ms:100,volume:10}]},
  {name:'計算',params:['入力'],returns:true,results:[{param:'入力'},{op:'mul',left:{param:'入力'},right:2}],body:[]}
]};

test('EV3RT source, configuration, motor types and project IR form a buildable SDK folder',()=>{
  const built=exportEV3RT(sample,{name:'Lesson-1',motorTypes:{B:'medium'}}),c=expandedSource(built);
  assert.match(c,/ev3_motor_config\(EV3_PORT_B, MEDIUM_MOTOR\)/);
  assert.match(c,/ev3_motor_config\(EV3_PORT_C, LARGE_MOTOR\)/);
  assert.match(c,/ev3_sensor_config\(EV3_PORT_1, ULTRASONIC_SENSOR\)/);
  assert.match(c,/ev3_sensor_config\(EV3_PORT_2, TOUCH_SENSOR\)/);
  assert.match(c,/lab_finite\(6,/);assert.match(c,/lab_result_\d+\.value\[1\]/);
  assert.doesNotMatch(c.replace(/\/\*[\s\S]*?\*\//g,''),/回数|周波数|計算|入力/,'user identifiers appear only in escaped comments');
  assert.match(c,/EBLの変数「回数／＊」/);
  assert.match(built.files['Lesson-1/app.cfg'],/DOMAIN\(TDOM_APP\)/);
  assert.match(built.files['Lesson-1/README.txt'],/make app=Lesson-1/);
  assert.deepEqual(JSON.parse(built.files['Lesson-1/program-ir.json']),sample);
});

test('export leaves the IR and ordinary RBF output unchanged',()=>{
  const input=structuredClone(sample),snapshot=JSON.stringify(input),before=compile(input).data;
  exportEV3RT(input);assert.equal(JSON.stringify(input),snapshot);assert.deepEqual(compile(input).data,before);
});

test('API-constrained blocks fail the entire export, even in branches and My Blocks',()=>{
 const pulse={type:'led',color:1,mode:'pulse'};
 for(const main of [[pulse],[{type:'if',condition:0,then:[pulse],else:[]}]])assert.throws(()=>exportEV3RT({main,procedures:[]}),/公開API/);
 assert.throws(()=>exportEV3RT({main:[{type:'call',name:'p',args:[]}],procedures:[{name:'p',params:[],body:[pulse]}]}),/公開API/);
});

test('invalid filenames, hardware and conflicting sensor types are rejected',()=>{
  for(const name of ['../app','a/b','x"','', 'x'.repeat(32)])assert.throws(()=>exportEV3RT(sample,{name}));
  assert.throws(()=>exportEV3RT(sample,{motorTypes:{B:'invalid'}}),/L\/M/);
  const main=['touch','distance'].map(kind=>({type:'set',var:'x',value:{sensor:{kind,port:1}}}));
  assert.throws(()=>exportEV3RT({main,procedures:[]}),/同じセンサーポート/);
});

test('ZIP source records have correct lengths, offsets and UTF-8 flags',()=>{
  const built=exportEV3RT(sample),zip=sourceZip(built.files),v=new DataView(zip.buffer);
  let offset=0,index=0;const contents=Object.entries(built.files);
  while(v.getUint32(offset,true)===0x04034b50){
    const size=v.getUint32(offset+18,true),length=v.getUint16(offset+26,true),start=offset+30;
    assert.equal(v.getUint16(offset+6,true),0x800);
    assert.equal(new TextDecoder().decode(zip.slice(start,start+length)),contents[index][0]);
    assert.equal(new TextDecoder().decode(zip.slice(start+length,start+length+size)),contents[index][1]);
    offset=start+length+size;index++;
  }
  assert.equal(index,contents.length);assert.equal(v.getUint32(offset,true),0x02014b50);
  assert.equal(v.getUint32(zip.length-22,true),0x06054b50);
  assert.equal(v.getUint32(zip.length-6,true),offset);
  assert.throws(()=>sourceZip({'../app.c':'bad'}));
});
