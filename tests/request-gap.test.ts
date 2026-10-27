import test from 'node:test';import assert from 'node:assert/strict';import {PriorityPool} from '../electron/priority-pool';
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('first request is immediate and next request waits five seconds after completion, not start',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0;const pool=new PriorityPool(1,()=>{},5000,()=>now);const starts:string[]=[];let finish:()=>void=()=>{};
 const first=pool.run(1,async()=>{starts.push('first');await new Promise<void>(r=>finish=r);});const second=pool.run(1,async()=>{starts.push('second');});assert.deepEqual(starts,['first']);
 now=20_000;t.mock.timers.tick(20_000);assert.deepEqual(starts,['first']);finish();await first;await flush();assert.deepEqual(pool.snapshot,{active:0,queued:1,capacity:1});
 now+=4999;t.mock.timers.tick(4999);await flush();assert.deepEqual(starts,['first']);now++;t.mock.timers.tick(1);await second;assert.deepEqual(starts,['first','second']);
});
test('failed requests also impose the gap; late questions keep queue priority without bypassing cooldown',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0;const pool=new PriorityPool(1,()=>{},5000,()=>now);const starts:string[]=[];
 await assert.rejects(pool.run(2,async()=>{starts.push('failure');throw Error('network');}));await flush();
 now=2000;const background=pool.run(2,async()=>{starts.push('background');});now=3000;const question=pool.run(0,async()=>{starts.push('question');});
 now=4999;t.mock.timers.tick(1999);await flush();assert.deepEqual(starts,['failure']);now=5000;t.mock.timers.tick(1);await question;await flush();assert.deepEqual(starts,['failure','question']);
 now=10_000;t.mock.timers.tick(5000);await background;assert.deepEqual(starts,['failure','question','background']);
});
test('pause cancels queued cooldown work; resume retains remaining gap but never adds five seconds after idle',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0;const pool=new PriorityPool(1,()=>{},5000,()=>now);let calls=0;
 await pool.run(1,async()=>{calls++;});await flush();const signal=new AbortController(),queued=pool.run(1,async()=>{calls++;},signal.signal);signal.abort();await assert.rejects(queued,{name:'AbortError'});assert.equal(pool.snapshot.queued,0);
 now=2000;const resumed=pool.run(1,async()=>{calls++;});now=4999;t.mock.timers.tick(2999);await flush();assert.equal(calls,1);now=5000;t.mock.timers.tick(1);await resumed;await flush();
 now=20_000;await pool.run(1,async()=>{calls++;});assert.equal(calls,3);
});
