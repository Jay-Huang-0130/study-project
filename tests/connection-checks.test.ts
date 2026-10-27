import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {CodexClient} from '../electron/codex';import {Store} from '../electron/store';import {Engine} from '../electron/engine';import {ConnectionChecks,directCheck} from '../electron/connection-checks';import {safeError} from '../electron/model-events';import {ModelDiagnostics} from '../electron/diagnostics';import {traceEvidence} from '../src/trace-evidence';
async function until(f:()=>boolean){const end=Date.now()+3000;while(!f()){if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,5));}}
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function fixture(){
 const dir=mkdtempSync(path.join(os.tmpdir(),'study-checks-')),file=path.join(dir,'x.pdf');writeFileSync(file,'%PDF-fixture');const store=new Store(path.join(dir,'library')),book=store.import(file);book.count=1;book.extraction='done';book.generationPaused=true;book.generationStarted=false;book.pages=[{number:1,text:'private textbook content',width:10,height:10,imageReady:true,lesson:'saved lesson',status:'done',messages:[]}];store.settings.model='mock';
 const client=new CodexClient('unused','unused'),engine=new Engine(store,client,()=>{},()=>{},undefined,0);engine.authenticated=true;
 return {dir,store,book,client,engine,checks:new ConnectionChecks(engine,client,store,()=>{}),close:()=>{engine.stop();rmSync(dir,{recursive:true,force:true});}};
}
test('error metadata exports only allowlisted codes and HTTP status, never raw error details',()=>{
 assert.deepEqual(safeError({message:'secret token',additionalDetails:'https://private',codexErrorInfo:{httpConnectionFailed:{httpStatusCode:429,token:'secret'}}}),{code:'httpConnectionFailed',httpStatus:429});
 assert.deepEqual(safeError({codexErrorInfo:'secret-token'}),{});assert.deepEqual(safeError({code:-32001}),{code:'serverOverloaded'});
 const d=new ModelDiagnostics(()=>1),id=d.begin({bookId:'b',kind:'probe',pages:[],model:'m'});for(let i=0;i<500;i++)d.event(id,{type:'reasoning'});assert.equal(d.snapshot()[0].events!.length,1);assert.equal(d.snapshot()[0].events![0].count,500);
 for(let i=0;i<100;i++)d.event(id,{type:i%2?'item-started':'content'});assert.equal(d.snapshot()[0].events!.length,60);
 d.event(id,{type:'upstream-error',...safeError({codexErrorInfo:{httpConnectionFailed:{httpStatusCode:429}},message:'secret token'})});assert.ok(!JSON.stringify(d.snapshot()).includes('secret'));assert.match(traceEvidence(d.snapshot()[0]),/HTTP 429/);
});
test('manual probes are idle on startup; text/page tests never modify book lessons and direct input is frozen',async()=>{
 const f=fixture();try{
  let calls=0,snapshot:any;f.client.generate=async(prompt,images,model,_guide,_d,_s,_signal,activity,event)=>{calls++;snapshot={prompt,images,model};activity?.('starting');event?.({type:'request-sent'});return images.length?'{"page":1,"lesson":"short explanation"}':'OK';};
  assert.equal(f.checks.snapshot().status,'idle');assert.equal(calls,0);
  f.checks.start('text');await until(()=>f.checks.snapshot().status==='done');assert.equal(f.checks.snapshot().matched,true);
  f.checks.start('page',f.book.id,1);await until(()=>f.checks.snapshot().history!.length===2);const original={...snapshot};f.store.settings.model='changed-model';f.book.pages[0].text='changed text';
  f.client.start=async()=>{};f.client.call=async(method,params:any)=>{if(method==='thread/start'){assert.equal(params.model,original.model);return {thread:{id:'direct'}};}if(method==='turn/start'){assert.equal(params.input[0].text,original.prompt);assert.deepEqual(params.input.filter((x:any)=>x.type==='localImage').map((x:any)=>x.path),original.images);setTimeout(()=>{f.client.emit('notification','item/agentMessage/delta',{threadId:'direct',turnId:'turn',delta:'{"page":1,"lesson":"short explanation"}'});f.client.emit('notification','turn/completed',{threadId:'direct',turn:{id:'turn',status:'completed'}});},0);return {turn:{id:'turn'}};}return {};};
  f.checks.start('direct');await until(()=>f.checks.snapshot().history!.length===3);assert.equal(calls,2);assert.equal(f.checks.snapshot().matched,true);assert.equal(f.book.pages[0].lesson,'saved lesson');assert.equal(f.engine.progress.modelActive,0);
  const exported=JSON.stringify(f.checks.snapshot());assert.ok(!exported.includes('private textbook content'));assert.ok(!exported.includes('short explanation'));
 }finally{f.close();}
});
test('active background work blocks probes, never creates a competing model call',async()=>{
 const f=fixture();try{f.book.generationStarted=true;f.book.generationPaused=false;f.book.pages[0].status='pending';let calls=0;f.client.generate=async()=>{calls++;return 'OK';};f.checks.start('text');await until(()=>f.checks.snapshot().status==='error');assert.equal(calls,0);assert.match(f.checks.snapshot().error!,/暫停/);}finally{f.close();}
});
test('manual cancellation and 120-second diagnostic deadline free the global slot without retrying',async t=>{
 const f=fixture();try{
  f.client.generate=async()=>new Promise(()=>{});f.checks.start('text');await until(()=>f.engine.progress.modelActive===1);f.checks.cancel();await until(()=>f.checks.snapshot().status==='cancelled');assert.equal(f.engine.progress.modelActive,0);
  t.mock.timers.enable({apis:['setTimeout']});f.checks.start('text');await flush();t.mock.timers.tick(120_000);await flush();assert.equal(f.checks.snapshot().status,'cancelled');assert.match(f.checks.snapshot().error!,/120 秒/);assert.equal(f.engine.progress.modelActive,0);
 }finally{f.close();}
});
test('direct protocol cancellation interrupts a late acknowledged turn without re-entering generate',async()=>{
 const client=new CodexClient('unused','unused'),calls:any[]=[],controller=new AbortController();let release:(v:any)=>void=()=>{};
 client.start=async()=>{};client.generate=async()=>{throw Error('must not call generate');};client.call=async(method,params)=>{calls.push({method,params});if(method==='thread/start')return {thread:{id:'d'}};if(method==='turn/start')return new Promise(r=>release=r);return {};};
 const task=directCheck(client,{prompt:'p',images:[],model:'m'},controller.signal,()=>{},()=>{});await until(()=>calls.some(c=>c.method==='turn/start'));controller.abort();await assert.rejects(task,{name:'AbortError'});release({turn:{id:'late'}});await flush();assert.deepEqual(calls.find(c=>c.method==='turn/interrupt').params,{threadId:'d',turnId:'late'});assert.equal(client.listenerCount('notification'),0);
});
test('direct completion before RPC acknowledgement removes the pending RPC and its timer',async()=>{
 const client=new CodexClient('unused','unused');client.start=async()=>{};
 (client as any).send=(m:any)=>{if(m.method==='thread/start')(client as any).receive({id:m.id,result:{thread:{id:'d'}}});if(m.method==='thread/unsubscribe')(client as any).receive({id:m.id,result:{}});};
 const task=directCheck(client,{prompt:'p',images:[],model:'m'},new AbortController().signal,()=>{},()=>{});await flush();client.emit('notification','item/agentMessage/delta',{threadId:'d',turnId:'t',delta:'OK'});client.emit('notification','turn/completed',{threadId:'d',turn:{id:'t',status:'completed'}});assert.equal(await task,'OK');await flush();assert.equal((client as any).pending.size,0);assert.equal(client.listenerCount('notification'),0);
});
