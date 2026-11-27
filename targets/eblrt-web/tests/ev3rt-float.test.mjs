import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cFloatLiteral} from '../dist/ev3rt-float.js';
import {exportEV3RT} from '../dist/ev3rt.js';
import {compile} from '../dist/ev3.js';

test('classroom float values use readable decimal literals with float suffixes',()=>{
 for(const [value,expected]of [[20,'20.0f'],[90,'90.0f'],[-20,'-20.0f'],[0.5,'0.5f'],[0.1,'0.1f'],[56,'56.0f'],[112,'112.0f'],[0,'0.0f'],[-0,'-0.0f']])assert.equal(cFloatLiteral(value),expected);
 assert.match(cFloatLiteral(1e-10),/e-10f$/);assert.match(cFloatLiteral(1e20),/e\+20f$/);
 for(const v of [NaN,Infinity,-Infinity,1e39,'20'])assert.throws(()=>cFloatLiteral(v),/数値/);
});
test('readable literals preserve binary32 values across boundaries and 10000 finite bit patterns',()=>{
 const buffer=new ArrayBuffer(4),view=new DataView(buffer);
 let seed=0x45b37021;
 const check=value=>{
   const literal=cFloatLiteral(value);
   assert.match(literal,/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?f$/);
   assert.ok(Object.is(Math.fround(Number(literal.slice(0,-1))),Math.fround(value)),value+' -> '+literal);
 };
 for(const v of [Math.PI,1/3,1e-6,1e9,16777215,16777217,3.4028234663852886e38,1.401298464324817e-45,-1e-50])check(v);
 for(let i=0;i<10000;i++) {
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;view.setUint32(0,seed);
   const value=view.getFloat32(0);if(Number.isFinite(value))check(value);
 }
});
test('readable numeric output changes neither block IR nor standard RBF compilation',()=>{
 const p={main:[{type:'set',var:'speed',value:20},{type:'wait',ms:0.5}],procedures:[]};
 const snapshot=JSON.stringify(p),rbf=compile(p).data;
 const built=exportEV3RT(p),source=built.files['EV3Lab/app.c'];
 assert.match(source,/lab_number\(20\.0f\)/);assert.match(source,/lab_number\(0\.5f\)/);
 assert.doesNotMatch(source,/2\.00000000e\+1f/);
 assert.equal(JSON.stringify(p),snapshot);assert.deepEqual(compile(p).data,rbf);
});
