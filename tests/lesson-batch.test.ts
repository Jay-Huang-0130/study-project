import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,normalizeSettings} from '../electron/store';import {Engine,type Provider} from '../electron/engine';
import {LessonBatchStream,lessonBatchPages} from '../electron/lesson-batch';
const row=(page:number,lesson=`講稿 ${page}`)=>JSON.stringify({page,lesson});
async function until(f:()=>boolean){const end=Date.now()+4000;while(!f()){if(Date.now()>end)throw Error('Timed out');await new Promise(r=>setTimeout(r,5));}}
function fixture(count=8){
 const dir=mkdtempSync(path.join(os.tmpdir(),'study-batch-'));const pdf=path.join(dir,'source.pdf');writeFileSync(pdf,'%PDF-fixture');const store=new Store(path.join(dir,'data')),book=store.import(pdf);
 book.count=count;book.extraction='done';book.generationPaused=false;book.generationStarted=true;
 book.pages=Array.from({length:count},(_,i)=>({number:i+1,text:`source ${i+1}`,width:100,height:100,imageReady:true,lesson:'',status:'pending' as const,messages:[]}));
 book.map={version:'v1',complete:true,overview:'overview',terms:[],pages:book.pages.map(p=>({page:p.number,topic:'t',summary:'s',terms:[],relatedPages:[]}))};book.mapStatus='done';store.save(book);
 return {dir,store,book,close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('stream preserves Markdown/math and completes records even when every character is a separate delta',()=>{
 const records:any[]=[];const text=[row(1,'# 標題\n\n$$L=2^{6.625}$$\n"引號"與 {大括號} \\quad'),row(2)].join('\n');
 const parser=new LessonBatchStream([1,2],p=>records.push(p));for(let i=1;i<=text.length;i++)parser.update(text.slice(0,i));parser.update(text,true);
 assert.equal(records.length,2);assert.equal(records[0].lesson,JSON.parse(text.split('\n')[0]).lesson);
});
test('stream rejects missing, repeated, out-of-order, empty, malformed and revised pages without committing partial pages',()=>{
 for(const text of [row(2),row(1)+'\n'+row(1),row(1)+'\n{"page":2,"lesson":"',row(1)+' garbage',row(1)+'\n'+row(2,'')]){
  const rows:any[]=[];const parser=new LessonBatchStream([1,2],r=>rows.push(r));assert.throws(()=>parser.update(text,true));assert.ok(rows.length<=1);
 }
 const parser=new LessonBatchStream([1,2],()=>{});parser.update(row(1));assert.throws(()=>parser.update(row(1,'changed')+'\n'+row(2),true));
});
test('batch selection bounds dense prose, preserves cached holes and waits for earliest prerequisites',()=>{
 const f=fixture();try{
  assert.deepEqual(lessonBatchPages(f.book,'concise'),[1,2,3,4,5]);f.book.pages[1].status='done' as any;
  assert.deepEqual(lessonBatchPages(f.book,'concise'),[1,3,4,5,6]);f.book.pages[3].imageReady=false;
  assert.deepEqual(lessonBatchPages(f.book,'concise'),[1,3]);f.book.pages[3].imageReady=true;for(const p of f.book.map!.pages)p.density='dense';
  assert.deepEqual(lessonBatchPages(f.book,'detailed'),[1,3]);assert.equal(normalizeSettings({aiConcurrency:6}).aiConcurrency,1);
 }finally{f.close();}
});
test('one serial batch streams saved pages before request completion and navigation never changes dispatch',async()=>{
 const f=fixture();let engine:Engine|undefined;let release:(s:string)=>void=()=>{},delta:((s:string)=>void)|undefined;
 const prompts:string[]=[];let active=0,max=0;
 try{
  f.store.settings.aiConcurrency=6; // Even a stale in-memory setting cannot enable parallel calls.
  const provider:Provider={generate:async(prompt,_images,_m,_i,onDelta)=>{prompts.push(prompt);active++;max=Math.max(max,active);delta=onDelta;return new Promise<string>(r=>release=s=>{active--;r(s);});}};
  engine=new Engine(f.store,provider,()=>{},()=>{});engine.authenticated=true;engine.activeId=f.book.id;engine.wake();await until(()=>prompts.length===1);
  f.book.currentPage=8;engine.wake();delta!(row(1));assert.equal(f.book.pages[0].status,'done');assert.equal(f.book.pages[1].status,'running');
  assert.equal(new Store(f.store.root).book(f.book.id).pages[0].lesson,'講稿 1');assert.equal(prompts.length,1);
  release([1,2,3,4,5].map(n=>row(n)).join('\n'));await until(()=>prompts.length===2);assert.match(prompts[1],/唯一目標頁碼（依序）：6、7、8/);assert.equal(max,1);
  release([6,7,8].map(n=>row(n)).join('\n'));await until(()=>engine!.bookState(f.book)==='complete');assert.equal(prompts.length,2);
 }finally{engine?.stop();release('');await new Promise(r=>setImmediate(r));f.close();}
});
test('pause keeps completed records; late data is ignored and resume requests only missing pages',async()=>{
 const f=fixture(5);let engine:Engine|undefined;const requests:{prompt:string;signal:AbortSignal;delta?:(s:string)=>void;resolve:(s:string)=>void}[]=[];
 try{
  engine=new Engine(f.store,{generate:async(prompt,_images,_m,_i,delta,_schema,signal)=>new Promise<string>(resolve=>requests.push({prompt,signal:signal!,delta,resolve}))},()=>{},()=>{});engine.authenticated=true;engine.wake();await until(()=>requests.length===1);
  requests[0].delta!(row(1)+'\n'+row(2));engine.pauseBook(f.book.id);await until(()=>engine!.progress.modelActive===0);assert.ok(requests[0].signal.aborted);
  requests[0].delta!([1,2,3].map(n=>row(n)).join('\n'));requests[0].resolve([1,2,3,4,5].map(n=>row(n)).join('\n'));assert.equal(f.book.pages[2].status,'pending');
  engine.resumeBook(f.book.id);await until(()=>requests.length===2);assert.match(requests[1].prompt,/唯一目標頁碼（依序）：3、4、5/);
  requests[1].resolve([3,4,5].map(n=>row(n)).join('\n'));await until(()=>engine!.bookState(f.book)==='complete');assert.equal(f.book.pages[0].lesson,'講稿 1');
 }finally{engine?.stop();for(const r of requests)r.resolve('');await new Promise(r=>setImmediate(r));f.close();}
});
test('truncated final response preserves earlier pages and pauses instead of marking missing pages complete',async()=>{
 const f=fixture(3);let engine:Engine|undefined;try{
  engine=new Engine(f.store,{generate:async(_p,_im,_m,_i,delta)=>{delta!(row(1));return row(1)+'\n{"page":2,"lesson":"partial';}},()=>{},()=>{});engine.authenticated=true;engine.wake();
  await until(()=>!!f.book.generationPaused);assert.equal(f.book.pages[0].status,'done');assert.equal(f.book.pages[1].status,'pending');assert.equal(f.book.pages[2].status,'pending');assert.match(f.book.pauseReason!,/截斷/);
 }finally{engine?.stop();f.close();}
});
test('index, batch lessons, overview, questions and concept requests share one provider slot',async()=>{
 const f=fixture(12);let engine:Engine|undefined,active=0,max=0;const starts:string[]=[];
 try{
  f.book.map=undefined;f.book.mapChunks=[];f.book.mapStatus='pending';
  const provider:Provider={generate:async(prompt,images,_m,_i,delta,schema:any)=>{
   active++;max=Math.max(max,active);try{await new Promise(r=>setTimeout(r,8));
    if(schema?.properties?.pages){starts.push(`index:${images.length}`);return JSON.stringify({pages:images.map(p=>({page:Number(p.match(/p(\d+)\.jpg$/)![1]),topic:'t',summary:'s',terms:[],relatedPages:[]}))});}
    if(schema?.properties?.links){starts.push('overview');return JSON.stringify({overview:'full',terms:[],links:f.book.pages.map(p=>({page:p.number,relatedPages:[]}))});}
    if(prompt.includes('本次唯一目標頁碼')){starts.push('lesson');return prompt.match(/唯一目標頁碼（依序）：([\d、]+)/)![1].split('、').map(n=>row(Number(n))).join('\n');}
    starts.push('question/review');return 'answer';
   }finally{active--;}
  }};
  engine=new Engine(f.store,provider,()=>{},()=>{});engine.authenticated=true;engine.wake();await until(()=>f.book.pages[0].status==='done');
  const a=engine.ask(f.book.id,1,'question'),b=engine.generateReview(f.book,new AbortController().signal,'review',[],'test');await Promise.all([a,b]);
  await until(()=>engine!.bookState(f.book)==='complete');assert.equal(max,1);assert.equal(starts[0],'index:5');assert.equal(starts.filter(s=>s==='lesson').length,3);assert.equal(starts.filter(s=>s.startsWith('index')).length,2);assert.equal(f.book.mapStatus,'done');
 }finally{engine?.stop();f.close();}
});
