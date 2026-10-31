import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../dist/ev3.js';
import {runParallel} from './helpers/parallel-vm.mjs';
import {scanImage} from './helpers/image-scan.mjs';
const call=(name,...args)=>({callValue:{name,args}});
const op=(op,left,right)=>({op,left,right});
const set=(name,value)=>({type:'set',var:name,value});
const value=name=>({var:name});
const param=name=>({param:name});
const wait=seconds=>({type:'waitSeconds',seconds});
function run(p,options){const build=compile(p);scanImage(build.data);const result=runParallel(build.data,options);const names=[];const visit=x=>{if(!x||typeof x!=='object')return;if(typeof x.var==='string'&&!names.includes(x.var))names.push(x.var);Object.values(x).forEach(visit);};visit(build.program);return {...result,build,get:name=>result.shared.getFloat32(names.indexOf(name)*4,true)};}
test('native output parameters support fractional results, nested calls and arithmetic snapshots',()=>{
 const p={main:[set('global',2),set('out',op('add',value('global'),call('sum',call('side'),call('sum',1.25,2.5))))],procedures:[
 {name:'sum',params:['a','b'],returns:true,body:[],result:op('add',param('a'),param('b'))},
 {name:'side',params:[],returns:true,body:[set('global',99)],result:3.5}]};
 const r=run(p);assert.equal(r.get('out'),9.25);assert.equal(r.get('global'),99);assert.equal(r.tasks,0);
 assert.ok(r.build.objects.some(o=>o.code[0]===3&&o.code[3]===0x43));
});
test('numeric early return exits loops and conditions, then the caller continues',()=>{
 const r=run({main:[set('a',call('abs',-4.5)),set('b',call('abs',3.25)),set('after',1)],procedures:[{name:'abs',params:['n'],returns:true,body:[{type:'repeat',count:10,body:[{type:'if',condition:op('lt',param('n'),0),then:[{type:'returnValue',value:op('mul',param('n'),-1)}],else:[]}]}],result:param('n')}]});
 assert.equal(r.get('a'),4.5);assert.equal(r.get('b'),3.25);assert.equal(r.get('after'),1);
});
test('an empty definition can return another function result directly',()=>{
 const r=run({main:[set('out',call('outer',3.5))],procedures:[{name:'outer',params:['n'],returns:true,body:[],result:call('inner',param('n'))},{name:'inner',params:['n'],returns:true,body:[],result:op('mul',param('n'),2)}]});
 assert.equal(r.get('out'),7);
});
test('parallel callers keep results separate and can wait or change shared values without deadlock',()=>{
 const r=run({main:[set('left',call('slow',2.5))],threads:[{kind:'start',body:[set('right',call('slow',7.25))]}],procedures:[{name:'slow',params:['n'],returns:true,body:[wait(.1),{type:'change',var:'total',value:1}],result:op('mul',param('n'),2)}]});
 assert.equal(r.get('left'),5);assert.equal(r.get('right'),14.5);assert.equal(r.get('total'),2);assert.equal(r.tasks,0);assert.ok(r.time<150);
});
test('functions used in event conditions are cloned and sensor mode conflicts are checked',()=>{
 const procedure={name:'touch',params:[],returns:true,body:[],result:{sensor:{kind:'touch',port:1}}};
 const r=run({main:[wait(.1),{type:'programEnd'}],threads:[{kind:'condition',condition:call('touch'),body:[set('pressed',1)]}],procedures:[procedure]},{sensorRead:()=>1});
 assert.equal(r.get('pressed'),1);assert.ok(r.stopped);
 assert.throws(()=>compile({main:[set('x',{sensor:{kind:'color',port:1}})],threads:[{kind:'condition',condition:call('touch'),body:[wait(.1)]}],procedures:[procedure]}),/モード/);
});
test('return expressions may inherit or establish movement settings, but never bypass unset checks',()=>{
 const setup={name:'setup',params:[],returns:true,body:[{type:'movementSetup',leftPort:1,rightPort:8},{type:'wheel',diameter:56}],result:20};
 const p={main:[set('distance',call('setup')),{type:'drive',movement:true,direction:'forward',speed:20,cm:value('distance')}],procedures:[setup]};
 const r=run(p);assert.ok(r.events.some(e=>['motor','motorSync'].includes(e.type)&&e.ports===9));
 assert.throws(()=>compile({...p,procedures:[{...setup,body:[{type:'wheel',diameter:56}]}]}),/モーターを設定/);
});
test('invalid return contexts, call kinds and recursive expression calls are rejected',()=>{
 const returning={name:'f',params:[],returns:true,body:[],result:1};
 assert.throws(()=>compile({main:[{type:'returnValue',value:1}],procedures:[]}),/中だけ/);
 assert.throws(()=>compile({main:[{type:'call',name:'f',args:[]}],procedures:[returning]}),/入力欄/);
 assert.throws(()=>compile({main:[set('x',call('f'))],procedures:[{...returning,returns:false}]}),/数値を返す/);
 assert.throws(()=>compile({main:[set('x',call('f'))],procedures:[{...returning,result:call('f')}]}),/再帰/);
 assert.throws(()=>compile({main:[set('x',call('f'))],procedures:[{...returning,body:[{type:'myblockReturn'}]}]}),/値を返す/);
 assert.throws(()=>compile({main:[set('x',call('f'))],procedures:[{...returning,result:undefined}]}),/引数/);
});
test('eight input parameters plus one output use the native header and all inputs survive',()=>{
 const params=Array.from({length:8},(_,i)=>'p'+i),result=params.map(param).reduce((a,b)=>op('add',a,b));
 const r=run({main:[set('out',call('sum',1,2,3,4,5,6,7,8))],procedures:[{name:'sum',params,returns:true,body:[],result}]});
 assert.equal(r.get('out'),36);assert.deepEqual(r.build.objects[1].code.slice(0,10),[9,...Array(8).fill(0x83),0x43]);
});
test('a function in a guarded motor input executes once, while loop conditions read it again',()=>{
 const next={name:'next',params:[],returns:true,body:[{type:'change',var:'calls',value:1}],result:20};
 const r=run({main:[{type:'motor',ports:2,speed:call('next'),degrees:90}],procedures:[next]});
 assert.equal(r.get('calls'),1);assert.equal(r.events.find(e=>e.type==='motor').speed,20);
 const condition={name:'read',params:[],returns:true,body:[{type:'change',var:'reads',value:1}],result:{sensor:{kind:'touch',port:1}}};
 const loop=run({main:[{type:'while',until:true,condition:call('read'),body:[wait(.02)]}],procedures:[condition]},{sensorRead:({time})=>time>=60?1:0});
 assert.ok(loop.get('reads')>=2);assert.equal(loop.tasks,0);
});
test('broadcast-and-wait inside a numeric call lets its receiver update shared state',()=>{
 const r=run({main:[set('out',call('measure')),{type:'programEnd'}],threads:[{kind:'message',message:'measure',body:[wait(.02),set('sample',12.5)]}],procedures:[{name:'measure',params:[],returns:true,body:[{type:'broadcast',message:'measure',wait:true}],result:value('sample')}]});
 assert.equal(r.get('out'),12.5);assert.ok(r.stopped);
});
