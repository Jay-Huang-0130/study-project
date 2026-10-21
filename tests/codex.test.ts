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
