import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CodexClient} from '../electron/codex';

async function until(predicate:()=>boolean){for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw new Error('timed out');}
test('abort sends turn/interrupt for the exact turn, then unsubscribes and ignores late streaming',async()=>{
  const client=new CodexClient('unused','unused'),calls:Array<{method:string;params:any}>=[];let deltas=0;
  client.start=async()=>{};
  client.call=async(method,params)=>{calls.push({method,params});if(method==='thread/start')return {thread:{id:'thread-a'}};if(method==='turn/start')return {turn:{id:'turn-a'}};return {};};
  const controller=new AbortController(),task=client.generate('p',[],'m','i',()=>deltas++,undefined,controller.signal);
  await until(()=>calls.some(c=>c.method==='turn/start'));await new Promise(r=>setImmediate(r));controller.abort();
  await assert.rejects(task,{name:'AbortError'});await until(()=>calls.some(c=>c.method==='thread/unsubscribe'));
  assert.deepEqual(calls.find(c=>c.method==='turn/interrupt')?.params,{threadId:'thread-a',turnId:'turn-a'});
  assert.ok(calls.findIndex(c=>c.method==='turn/interrupt')<calls.findIndex(c=>c.method==='thread/unsubscribe'));
  client.emit('notification','item/agentMessage/delta',{threadId:'thread-a',delta:'late'});assert.equal(deltas,0);assert.equal(client.listenerCount('notification'),0);
});
test('abort while turn/start is pending still interrupts once the server supplies its turn ID',async()=>{
  const client=new CodexClient('unused','unused'),calls:Array<{method:string;params:any}>=[];let release:(value:any)=>void=()=>{};
  client.start=async()=>{};
  client.call=async(method,params)=>{calls.push({method,params});if(method==='thread/start')return {thread:{id:'thread-b'}};if(method==='turn/start')return new Promise(r=>release=r);return {};};
  const controller=new AbortController(),task=client.generate('p',[],'m','i',undefined,undefined,controller.signal);
  await until(()=>calls.some(c=>c.method==='turn/start'));controller.abort();await assert.rejects(task,{name:'AbortError'});
  assert.equal(calls.some(c=>c.method==='thread/unsubscribe'),false);
  release({turn:{id:'turn-late'}});await until(()=>calls.some(c=>c.method==='thread/unsubscribe'));
  assert.deepEqual(calls.find(c=>c.method==='turn/interrupt')?.params,{threadId:'thread-b',turnId:'turn-late'});
});

function transport(){
 const client=new CodexClient('unused','unused'),calls:Array<{id:number;method:string;params:any}>=[];let threads=0;
 client.start=async()=>{};
 const receive=(message:any)=>(client as any).receive(message);
 (client as any).send=(message:any)=>{calls.push(message);if(message.method==='thread/start')receive({id:message.id,result:{thread:{id:`thread-${++threads}`}}});if(['turn/interrupt','thread/unsubscribe'].includes(message.method))receive({id:message.id,result:{}});};
 const notice=(method:string,threadId:string,extra:any={})=>receive({method,params:{threadId,...extra}});
 const complete=(threadId:string,text='講稿')=>{notice('item/agentMessage/delta',threadId,{delta:text});notice('turn/completed',threadId,{turn:{id:`turn-${threadId}`,status:'completed'}});};
 return {client,calls,receive,notice,complete,pending:()=>((client as any).pending as Map<unknown,unknown>).size};
}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}

test('turn/start may take over 60 seconds without abandoning or duplicating the request',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=transport();let settled=false;
 const task=f.client.generate('p',[],'m','i');void task.then(()=>settled=true,()=>settled=true);await flush();
 t.mock.timers.tick(61_000);await flush();assert.equal(settled,false);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
 const start=f.calls.find(c=>c.method==='turn/start')!;f.receive({id:start.id,result:{turn:{id:'accepted'}}});f.complete('thread-1');assert.equal(await task,'講稿');assert.equal(f.pending(),0);assert.equal(f.client.listenerCount('notification'),0);
});

test('turn/started is sufficient acceptance; delayed RPC reply cannot time out active streaming',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=transport(),task=f.client.generate('p',[],'m','i');await flush();
 const start=f.calls.find(c=>c.method==='turn/start')!;f.notice('turn/started','thread-1',{turn:{id:'event-id'}});await flush();assert.equal(f.pending(),0);
 t.mock.timers.tick(70_000);f.complete('thread-1','先完成的內容');assert.equal(await task,'先完成的內容');
 f.receive({id:start.id,error:{message:'stale reply'}});assert.equal(f.calls.some(c=>c.method==='turn/interrupt'),false);assert.equal(f.pending(),0);
});

test('completion before the start acknowledgement cleans up its RPC timer',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=transport(),task=f.client.generate('p',[],'m','i');await flush();f.complete('thread-1');assert.equal(await task,'講稿');
 t.mock.timers.tick(600_000);await flush();assert.equal(f.pending(),0);assert.equal(f.client.listenerCount('notification'),0);assert.equal(f.calls.filter(c=>c.method==='thread/unsubscribe').length,1);
});

test('cancel before acknowledgement interrupts the later turn/started ID and ignores late output',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=transport(),controller=new AbortController();let deltas=0;
 const task=f.client.generate('p',[],'m','i',()=>deltas++,undefined,controller.signal);await flush();controller.abort();await assert.rejects(task,{name:'AbortError'});
 f.notice('item/agentMessage/delta','thread-1',{delta:'late'});assert.equal(deltas,0);f.notice('turn/started','thread-1',{turn:{id:'late-event'}});await flush();
 assert.deepEqual(f.calls.find(c=>c.method==='turn/interrupt')?.params,{threadId:'thread-1',turnId:'late-event'});assert.equal(f.pending(),0);assert.equal(f.client.listenerCount('notification'),0);
});

test('eight-minute deadline pauses accepted and unacknowledged turns without sending an empty turn ID',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const accepted of [true,false]){const f=transport(),task=f.client.generate('p',[],'m','i');const rejected=assert.rejects(task,/8 分鐘/);await flush();
  if(accepted)f.notice('turn/started','thread-1',{turn:{id:'slow-id'}});
  t.mock.timers.tick(480_000);await rejected;await flush();
  if(accepted)assert.equal(f.calls.find(c=>c.method==='turn/interrupt')?.params.turnId,'slow-id');else{assert.equal(f.calls.some(c=>c.method==='turn/interrupt'),false);t.mock.timers.tick(30_000);await flush();}
  assert.equal(f.pending(),0);assert.equal(f.client.listenerCount('notification'),0);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);
 }
});

test('parallel slow-start and completed requests remain isolated',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=transport(),first=f.client.generate('first',[],'m','i'),second=f.client.generate('second',[],'m','i');await flush();
 f.complete('thread-2','第二頁');assert.equal(await second,'第二頁');t.mock.timers.tick(65_000);await flush();f.notice('turn/started','thread-1',{turn:{id:'first-id'}});f.complete('thread-1','第一頁');assert.equal(await first,'第一頁');assert.equal(f.pending(),0);assert.equal(f.calls.filter(c=>c.method==='turn/start').length,2);
});

test('ordinary RPCs retain their 60-second timeout and dispose pending entries',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=transport(),task=f.client.call('model/list'),rejected=assert.rejects(task,/model\/list 等待逾時/);t.mock.timers.tick(60_000);await rejected;assert.equal(f.pending(),0);
});
