import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateManifest,verifyPart} from '../dist/windows-download.js';
test('download rejects corrupt bytes and unsafe or reordered part paths',async()=>{
 const data=new TextEncoder().encode('verified zip part'),sha256=createHash('sha256').update(data).digest('hex');
 const part={path:'downloads/windows-0.3.6/part-001.bin',bytes:data.byteLength,sha256};
 const m={name:'EBL-RT-Windows-0.3.6.zip',bytes:data.byteLength,sha256,parts:[part]};
 assert.equal(validateManifest(m),m);await verifyPart(data,part);
 await assert.rejects(verifyPart(data.slice(1),part),/サイズ/);
 await assert.rejects(verifyPart(new Uint8Array(data.byteLength),part),/照合/);
 for(const path of ['../secret','https://example.com/evil','downloads/windows-0.3.6/part-002.bin'])assert.throws(()=>validateManifest({...m,parts:[{...part,path}]}));
 assert.throws(()=>validateManifest({...m,bytes:m.bytes+1}));
});
test('OS package manifest is complete and matches all downloadable files',async()=>{
 const root=new URL('../dist/os-patch/',import.meta.url),m=JSON.parse(await readFile(new URL('MANIFEST.json',root),'utf8'));
 assert.equal(m.version,'0.1.1-experimental');
 for(const f of m.files){assert.match(f.path,/^[\x20-\x7e]+$/);assert(!f.path.includes('..'));assert(!/uImage$/.test(f.path));const bytes=await readFile(new URL(f.path,root));assert.equal(bytes.length,f.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);}
 const readme=await readFile(new URL('README.txt',root),'utf8');assert.match(readme,/完全にシャットダウン/);assert.match(readme,/元へ戻す/);assert.match(readme,/自分で適用/);
});
test('evaluation page separates PC-only review and optional patched-OS hardware evaluation',async()=>{
 const html=await readFile(new URL('../dist/evaluation.html',import.meta.url),'utf8');
 for(const id of ['code','windows','hardware','patch','report'])assert(html.includes(`id="${id}"`));
 for(const href of ['evaluation.css','windows-download.js','downloads/EV3RT-HRP3-SVC-Patch-v0.1.1.zip','os-patch/index.html'])await stat(new URL('../dist/'+href,import.meta.url));
 assert.match(html,/初回起動にはインターネット接続/);assert.match(html,/公式採用/);assert.match(html,/OSの変更は不要/);
});
test('all downloadable Windows parts reconstruct the declared public ZIP',async()=>{
 const dist=new URL('../dist/',import.meta.url),manifest=validateManifest(JSON.parse(await readFile(new URL('downloads/windows-0.3.6.json',dist),'utf8'))),whole=createHash('sha256');
 let bytes=0;
 for(const part of manifest.parts){const data=await readFile(new URL(part.path,dist));await verifyPart(data,part);whole.update(data);bytes+=data.length;}
 assert.equal(bytes,manifest.bytes);assert.equal(whole.digest('hex'),manifest.sha256);
});
