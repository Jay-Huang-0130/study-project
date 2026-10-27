import test from 'node:test';import assert from 'node:assert/strict';import {Writable} from 'node:stream';
import {RpcWriter} from '../electron/rpc-writer';import {CodexClient} from '../electron/codex';
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function fixture(highWaterMark=1024){
 const chunks:string[]=[],callbacks:((error?:Error|null)=>void)[]=[],events:any[]=[],errors:Error[]=[];
 const pipe=new Writable({highWaterMark,write(chunk,_encoding,callback){chunks.push(chunk.toString());callbacks.push(callback);}});
 const writer=new RpcWriter(pipe,()=>true,e=>errors.push(e));return {pipe,writer,chunks,callbacks,events,errors,write:(line:string,signal?:AbortSignal)=>writer.write(line,signal,e=>events.push(e))};
}
test('write completion waits for the callback; backpressure queues subsequent lines without resending',async()=>{
 const f=fixture(1);try{
  let completed=false;const first=f.write('first\n').then(()=>completed=true),second=f.write('second\n');assert.equal(completed,false);assert.deepEqual(f.chunks,['first\n']);assert.ok(f.events.some(e=>e.stage==='blocked'));
  f.callbacks[0]();await first;await flush();assert.deepEqual(f.chunks,['first\n','second\n']);f.callbacks[1]();await second;assert.equal(f.events.filter(e=>e.stage==='written').length,2);assert.equal(f.errors.length,0);
 }finally{f.writer.dispose();f.pipe.destroy();}
});
test('pause removes a queued write before any bytes are delivered and preserves FIFO for remaining writes',async()=>{
 const f=fixture(1);try{
  const a=f.write('a'),signal=new AbortController(),b=f.write('cancelled',signal.signal),c=f.write('c');signal.abort();await assert.rejects(b,{name:'AbortError'});f.callbacks[0]();await a;await flush();assert.deepEqual(f.chunks,['a','c']);f.callbacks[1]();await c;
 }finally{f.writer.dispose();f.pipe.destroy();}
});
test('asynchronous write failure rejects all active/queued writes once, sanitizes raw errors, and cannot report success',async()=>{
 const f=fixture(1);const a=f.write('private prompt'),b=f.write('private token');const rejected=Promise.all([assert.rejects(a,/管道失敗/),assert.rejects(b,/管道失敗/)]);
 f.callbacks[0](new Error('EPIPE private-token-123'));await rejected;await new Promise(r=>setImmediate(r));assert.equal(f.errors.length,1);assert.ok(!JSON.stringify(f.events).includes('private'));assert.ok(!f.events.some(e=>e.stage==='written'));assert.equal(f.writer.snapshot.queued,0);f.pipe.destroy();
});
test('closed and unavailable pipes fail immediately, without leaving RPC timers pending',async()=>{
 const client=new CodexClient('unused','unused');await assert.rejects(client.call('turn/start'),/程序不可用/);assert.equal(client.transport.pendingRPCs,0);
 const ended=new Writable({write(_c,_e,cb){cb();}});ended.end();const errors:Error[]=[],writer=new RpcWriter(ended,()=>true,e=>errors.push(e));await assert.rejects(writer.write('line'),/不可寫入/);assert.equal(errors.length,1);ended.destroy();
});
test('a pipe that never completes its write fails at 30 seconds rather than waiting for the model deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();const promise=f.write('never flushed'),rejected=assert.rejects(promise,/30 秒/);t.mock.timers.tick(29_999);await flush();assert.equal(f.errors.length,0);t.mock.timers.tick(1);await rejected;assert.equal((f.errors[0] as any).diagnostic.code,'pipeWriteTimeout');assert.equal(f.writer.snapshot.writing,false);f.pipe.destroy();
});
test('stream close fails writes and an unavailable process never receives bytes',async()=>{
 const f=fixture();const promise=f.write('line'),rejected=assert.rejects(promise,/已關閉/);f.pipe.destroy();await rejected;assert.equal(f.errors.length,1);
 const other=new Writable({write(){throw Error('must not write');}}),writer=new RpcWriter(other,()=>false,()=>{});await assert.rejects(writer.write('line'),/程序不可用/);other.destroy();
});
test('RPC details retain safe method name, write state and age; cancellation removes queued work',async()=>{
 const f=fixture(1),client=new CodexClient('unused','unused');(client as any).child={killed:false,exitCode:null,signalCode:null,stdin:f.pipe};(client as any).writer=f.writer;
 try{
  const first=client.call('turn/start',{private:'never exported'}),controller=new AbortController(),second=client.call('model/list',{},60_000,controller.signal);
  assert.deepEqual(client.transport.pending.map(p=>p.method),['turn/start','model/list']);assert.equal(client.transport.pending[0].writeState,'blocked');assert.equal(client.transport.pending[1].writeState,'queued');assert.ok(!JSON.stringify(client.transport).includes('never exported'));
  controller.abort();await assert.rejects(second,{name:'AbortError'});f.callbacks[0]();await flush();assert.equal(client.transport.pending[0].writeState,'written');assert.equal(f.chunks.length,1);
  (client as any).receive({id:1,result:{turn:{id:'t'}}});await first;assert.equal(client.transport.pending.length,0);
 }finally{f.writer.dispose();f.pipe.destroy();}
});
test('synchronous write exceptions become explicit sanitized failures',async()=>{
 const f=fixture();(f.pipe as any).write=()=>{throw Error('private path/token');};await assert.rejects(f.write('data'),/管道失敗/);assert.equal(f.errors.length,1);assert.ok(!f.errors[0].message.includes('private'));f.pipe.destroy();
});
test('cancelling generation while its start is still queued never sends that start later',async()=>{
 const f=fixture(1),client=new CodexClient('unused','unused');(client as any).child={killed:false,exitCode:null,signalCode:null,stdin:f.pipe};(client as any).writer=f.writer;client.start=async()=>{};
 const call=client.call.bind(client);client.call=async(method,params,timeout,signal,observe)=>method==='thread/start'?{thread:{id:'thread'}}:method==='thread/unsubscribe'?{}:call(method,params,timeout,signal,observe);
 try{
  const held=f.write('held'),controller=new AbortController(),task=client.generate('p',[],'m','i',undefined,undefined,controller.signal);await flush();assert.equal(client.transport.pending[0].method,'turn/start');assert.equal(client.transport.pending[0].writeState,'queued');controller.abort();await assert.rejects(task,{name:'AbortError'});await flush();
  f.callbacks[0]();await held;await flush();assert.deepEqual(f.chunks,['held']);assert.equal(client.transport.pending.length,0);assert.equal(client.listenerCount('notification'),0);
 }finally{f.writer.dispose();f.pipe.destroy();}
});
