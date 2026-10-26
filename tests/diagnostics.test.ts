import test from 'node:test';import assert from 'node:assert/strict';
import {ModelDiagnostics} from '../electron/diagnostics';
const metadata={bookId:'book',kind:'lesson' as const,pages:[1,2],model:'test'};
test('diagnostics separate queue, connection, acceptance, first output and completion without late-event regression',()=>{
 let now=0;const d=new ModelDiagnostics(()=>now),id=d.begin(metadata);now=100;d.mark(id,'connecting');now=200;d.mark(id,'thread');now=400;d.mark(id,'starting');now=2400;d.mark(id,'waiting');now=5400;d.mark(id,'receiving');now=6400;
 let record=d.snapshot()[0];assert.equal(record.phaseMs,1000);assert.equal(record.marks.connecting,100);assert.equal(record.marks.waiting,2400);assert.equal(record.marks.receiving,5400);d.mark(id,'waiting');assert.equal(d.snapshot()[0].phase,'receiving');
 d.finish(id);now=10000;record=d.snapshot()[0];assert.equal(record.elapsedMs,6400);d.mark(id,'receiving');assert.equal(d.snapshot()[0].elapsedMs,6400);
});
test('diagnostics retain cancellation stage, redact raw errors, filter books and bound completed history',()=>{
 let now=0;const d=new ModelDiagnostics(()=>now),id=d.begin(metadata);d.mark(id,'starting');now=100;d.finish(id,new DOMException('private prompt','AbortError'));
 assert.equal(d.snapshot('book')[0].phase,'cancelled');assert.equal(d.snapshot('book')[0].lastPhase,'starting');assert.equal(d.snapshot('other').length,0);assert.ok(!JSON.stringify(d.snapshot()).includes('private prompt'));
 const error=d.begin({...metadata,bookId:'other'});d.finish(error,new Error('usage limit token=secret'));assert.equal(d.snapshot('other')[0].failure,'quota');assert.ok(!JSON.stringify(d.snapshot()).includes('secret'));
 const active=d.begin(metadata);for(let i=0;i<220;i++){const key=d.begin(metadata);d.finish(key);}assert.equal(d.snapshot().length,200);assert.ok(d.snapshot().some(r=>r.id===active));
 const copy=d.snapshot()[0];copy.pages.push(99);copy.marks.queued=999;assert.ok(d.snapshot().every(r=>!r.pages.includes(99)&&r.marks.queued===0));
});
