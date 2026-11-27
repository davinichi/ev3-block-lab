import test from 'node:test';
import assert from 'node:assert/strict';
import {renderConnectionBadge} from '../dist/classroom-ui.js';
test('connection feedback recovers from cancellation, connection and disconnection without stale icons',()=>{
 const classes=new Set(),attrs=new Map(),label={textContent:''};
 const node={classList:{toggle(k,v){v?classes.add(k):classes.delete(k);}},querySelector:()=>label,getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v)};
 renderConnectionBadge(node,{connecting:true});assert.ok(classes.has('connecting'));assert.ok(!classes.has('connected'));
 renderConnectionBadge(node,{});assert.ok(!classes.has('connecting'));const offline=label.textContent;
 renderConnectionBadge(node,{connected:true,connecting:true});assert.ok(classes.has('connected'));assert.ok(!classes.has('connecting'));assert.notEqual(label.textContent,offline);
 renderConnectionBadge(node,{});assert.equal(label.textContent,offline);assert.ok(!classes.has('connected'));assert.ok(attrs.get('aria-label').includes(offline));
 renderConnectionBadge(node,{connected:true},()=> 'English status');assert.equal(label.textContent,'English status');
});
