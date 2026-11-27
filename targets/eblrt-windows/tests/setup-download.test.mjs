import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {downloadVerified} from '../setup-tools.mjs';
const bytes=Buffer.from('verified pinned package');
const digest=createHash('sha512').update(bytes).digest('hex');
const response=(url,body=bytes)=>({ok:true,status:200,url,body:new Response(body).body});
async function fixture(t){const dir=await mkdtemp(path.join(tmpdir(),'eblrt-download-'));t.after(()=>rm(dir,{recursive:true,force:true}));return path.join(dir,'package.tar.xz');}
test('verified cache works offline without contacting any mirror',async t=>{
 const file=await fixture(t);await writeFile(file,bytes);
 await downloadVerified('https://primary.test/p',file,'sha512',digest,bytes.length,{fetcher:()=>{throw Error('Network must not be called');}});
 assert.deepEqual(await readFile(file),bytes);
});
test('a timed-out mirror falls back to another HTTPS mirror with the same expected hash',async t=>{
 const file=await fixture(t),calls=[];
 await downloadVerified('https://primary.test/p',file,'sha512',digest,bytes.length,{fallbackUrls:['https://secondary.test/p'],fetcher:async url=>{calls.push(url);if(url.includes('primary'))throw new TypeError('fetch failed',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});return response(url);}});
 assert.equal(calls.length,2);assert.deepEqual(await readFile(file),bytes);
});
test('an interrupted partial download is overwritten before mirror retry',async t=>{
 const file=await fixture(t);let count=0;
 await downloadVerified('https://primary.test/p',file,'sha512',digest,bytes.length,{fallbackUrls:['https://secondary.test/p'],fetcher:async url=>{
  if(++count===1){let sent=false;return {ok:true,status:200,url,body:new ReadableStream({pull(controller){if(sent)controller.error(Error('connection reset'));else{sent=true;controller.enqueue(bytes.subarray(0,3));}}})};}
  return response(url);
 }});assert.deepEqual(await readFile(file),bytes);
});
test('a transient failure retries while an invalid cache is never accepted',async t=>{
 const file=await fixture(t);await writeFile(file,'corrupt');let calls=0;
 await downloadVerified('https://primary.test/p',file,'sha512',digest,bytes.length,{retryDelayMs:0,fetcher:async url=>{if(++calls===1)throw Error('temporary outage');return response(url);}});
 assert.equal(calls,2);assert.deepEqual(await readFile(file),bytes);
});
test('hash mismatch cannot become an installed archive and identifies the failed filename',async t=>{
 const file=await fixture(t);
 await assert.rejects(downloadVerified('https://primary.test/p',file,'sha512',digest,bytes.length,{attempts:1,fetcher:async url=>response(url,Buffer.alloc(bytes.length))}),/package\.tar\.xz[\s\S]*primary\.test: SHA mismatch/);
 await assert.rejects(stat(file),{code:'ENOENT'});
});
test('HTTP failures try another mirror and never install an error page',async t=>{
 const file=await fixture(t);let calls=0;
 await downloadVerified('https://primary.test/p',file,'sha512',digest,bytes.length,{fallbackUrls:['https://secondary.test/p'],fetcher:async url=>++calls===1?{...response(url,'Not found'),ok:false,status:404}:response(url)});
 assert.equal(calls,2);assert.deepEqual(await readFile(file),bytes);
});
test('an insecure fallback is rejected before any network request',async t=>{
 const file=await fixture(t);
 await assert.rejects(downloadVerified('https://primary.test/p',file,'sha512',digest,bytes.length,{fallbackUrls:['http://secondary.test/p'],fetcher:()=>{throw Error('must not fetch');}}),/HTTPS/);
});
