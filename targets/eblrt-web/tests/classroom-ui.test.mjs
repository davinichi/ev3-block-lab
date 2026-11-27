import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('language selection is always available before transfer, outside teaching tools',()=>{
 const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 const header=html.slice(html.indexOf('<header>'),html.indexOf('</header>'));
 assert.equal((html.match(/id="uiLanguage"/g)||[]).length,1);
 assert.ok(header.indexOf('id="uiLanguage"')<header.indexOf('id="toggleConnectionPanel"'));
 assert.ok(header.indexOf('id="uiLanguage"')<header.indexOf('id="fileMenu"'));
 assert.match(header,/<span>言語<\/span>/);
});
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
