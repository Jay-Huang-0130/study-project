import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,normalizeSettings} from '../electron/store';import {Engine,type Provider} from '../electron/engine';
import type {Book} from '../src/shared';
function fixture(count=40,capacity=3,indexed=true){
 const root=mkdtempSync(path.join(os.tmpdir(),'study-parallel-')),store=new Store(path.join(root,'library'));store.updateSettings({aiConcurrency:capacity});
 const books=[0,1].map(i=>{const file=path.join(root,`${i}.pdf`);writeFileSync(file,`%PDF-1.4 fixture ${i}`);const b=store.import(file);b.count=count;b.extraction='done';b.extracted=count;b.generationPaused=true;
 b.pages=Array.from({length:count},(_,i)=>({number:i+1,text:`原頁${i+1}`,width:100,height:100,imageReady:true,lesson:'',status:'pending' as const,messages:[]}));
 if(indexed){b.map={version:'v',complete:true,overview:'全書',terms:[],pages:b.pages.map(p=>({page:p.number,topic:'主題',summary:'摘要',terms:[],relatedPages:[]}))};b.mapChunks=[b.map.pages];b.mapStatus='done';}else{b.mapChunks=[];b.mapStatus='pending';}store.save(b);return b;});
 return {store,books,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
type Call={prompt:string;pages:number[];kind:'index'|'lesson'|'overview'|'other';signal:AbortSignal;delta?:((s:string)=>void);resolve:(s:string)=>void;reject:(e:Error)=>void;settled:boolean};
function controlled(){let active=0,max=0;const calls:Call[]=[];const provider:Provider={generate:async(prompt,images,_model,_instructions,delta,schema:any,signal)=>{active++;max=Math.max(max,active);let ended=false;const end=()=>{if(!ended){ended=true;active--;}};signal?.addEventListener('abort',end,{once:true});return new Promise<string>((resolve,reject)=>{
 const target=prompt.match(/唯一目標頁碼（依序）：([\d、]+)/),pages=target?target[1].split('、').map(Number):images.map(file=>Number(file.match(/p(\d+)\.jpg$/)![1]));
 const call:Call={prompt,pages,kind:target?'lesson':schema?.properties?.pages?'index':schema?.properties?.links?'overview':'other',signal:signal!,delta,settled:false,resolve:s=>{call.settled=true;end();resolve(s);},reject:e=>{call.settled=true;end();reject(e);}};calls.push(call);
 });}};return {calls,provider,get max(){return max;}};
}
const rows=(pages:number[])=>pages.map(page=>JSON.stringify({page,lesson:`講稿 ${page}`})).join('\n');
function response(c:Call,b:Book){return c.kind==='lesson'?rows(c.pages):c.kind==='index'?JSON.stringify({pages:c.pages.map(page=>({page,topic:'主題',summary:'摘要',terms:[],relatedPages:[]}))}):c.kind==='overview'?JSON.stringify({overview:'完整',terms:[],links:b.pages.map(p=>({page:p.number,relatedPages:[]}))}):'回答';}
async function until(fn:()=>boolean){const end=Date.now()+5000;while(!fn()){if(Date.now()>end)throw Error('parallel timed out');await new Promise(r=>setTimeout(r,5));}}
async function drain(engine:Engine,c:ReturnType<typeof controlled>,books:Book[]){const end=Date.now()+6000;while(engine.queue.length||engine.progress.modelActive){if(Date.now()>end)throw Error('drain timeout');for(const call of c.calls.filter(c=>!c.settled&&!c.signal.aborted)){const b=books.find(b=>call.prompt.includes(`教材：${b.name}`))??books[0];call.resolve(response(call,b));}await new Promise(r=>setTimeout(r,5));}}
test('settings preserve integer capacities 1-6; invalid values fall back and restart keeps explicit choice',()=>{
 for(let n=1;n<=6;n++)assert.equal(normalizeSettings({aiConcurrency:n}).aiConcurrency,n);
 for(const n of [0,7,-1,1.5,NaN,Infinity])assert.equal(normalizeSettings({aiConcurrency:n}).aiConcurrency,1);
 const f=fixture();try{f.store.updateSettings({aiConcurrency:6});assert.equal(new Store(f.store.root).settings.aiConcurrency,6);}finally{f.cleanup();}
});
test('six batches reserve distinct pages and refill immediately without waiting for the slow round',async()=>{
 const f=fixture(40,6),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{f.books.forEach(b=>engine.resumeBook(b.id));await until(()=>c.calls.length===6);assert.deepEqual(c.calls.slice(0,6).flatMap(c=>c.pages),Array.from({length:30},(_,i)=>i+1));
 c.calls[2].resolve(rows(c.calls[2].pages));await until(()=>c.calls.length===7);assert.deepEqual(c.calls[6].pages,[31,32,33,34,35]);assert.equal(c.calls[0].settled,false);assert.ok(c.calls.every(call=>call.prompt.includes(`教材：${f.books[0].name}`)));assert.equal(c.max,6);
 await drain(engine,c,f.books);assert.ok(f.books.every(b=>b.pages.every(p=>p.status==='done')));const firstSecond=c.calls.findIndex(call=>call.prompt.includes(`教材：${f.books[1].name}`));assert.equal(firstSecond,8);assert.equal(new Set(c.calls.slice(0,8).flatMap(c=>c.pages)).size,40);
 }finally{engine.stop();f.cleanup();}
});
test('streamed pages display early but outstanding batch leases still block the next PDF',async()=>{
 const f=fixture(10,2),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{f.books.forEach(b=>engine.resumeBook(b.id));assert.equal(c.calls.length,2);c.calls.forEach(call=>call.delta?.(rows(call.pages)));assert.ok(f.books[0].pages.every(p=>p.status==='done'));engine.wake();assert.equal(c.calls.length,2);assert.equal(engine.bookState(f.books[0]),'running');
 c.calls[1].resolve(rows(c.calls[1].pages));await until(()=>engine.progress.modelActive===1);engine.wake();assert.equal(c.calls.length,2);c.calls[0].resolve(rows(c.calls[0].pages));await until(()=>c.calls.length===4);assert.ok(c.calls[2].prompt.includes(`教材：${f.books[1].name}`));await drain(engine,c,f.books);
 }finally{engine.stop();f.cleanup();}
});
test('parallel index batches never overlap; overview waits for every original index job',async()=>{
 const f=fixture(35,4,false),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{engine.resumeBook(f.books[0].id);assert.equal(c.calls.length,4);assert.deepEqual(c.calls.map(c=>c.pages.length),[5,10,10,10]);assert.equal(new Set(c.calls.flatMap(c=>c.pages)).size,35);
 for(const i of [3,2,0])c.calls[i].resolve(response(c.calls[i],f.books[0]));await until(()=>c.calls.some(c=>c.kind==='lesson'));assert.equal(c.calls.some(c=>c.kind==='overview'),false);assert.deepEqual(c.calls.find(c=>c.kind==='lesson')!.pages,[1,2,3,4,5]);
 c.calls[1].resolve(response(c.calls[1],f.books[0]));await until(()=>c.calls.some(c=>c.kind==='overview'));await drain(engine,c,f.books);assert.equal(f.books[0].mapStatus,'done');assert.deepEqual(f.books[0].map!.pages.map(p=>p.page),Array.from({length:35},(_,i)=>i+1));assert.equal(c.calls.filter(c=>c.kind==='overview').length,1);
 }finally{engine.stop();f.cleanup();}
});
test('capacity decreases drain in-flight work without cancelling; increases refill dynamically',async()=>{
 const f=fixture(40,6),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{engine.resumeBook(f.books[0].id);assert.equal(c.calls.length,6);f.store.updateSettings({aiConcurrency:2});engine.wake();for(let i=0;i<4;i++)c.calls[i].resolve(rows(c.calls[i].pages));await until(()=>engine.progress.modelActive===2);engine.wake();assert.equal(c.calls.length,6);assert.ok(c.calls.every(c=>!c.signal.aborted));
 c.calls[4].resolve(rows(c.calls[4].pages));await until(()=>c.calls.length===7);assert.equal(engine.progress.modelActive,2);f.store.updateSettings({aiConcurrency:6});engine.wake();await until(()=>c.calls.length===8);await drain(engine,c,f.books);assert.ok(f.books[0].pages.every(p=>p.status==='done'));
 }finally{engine.stop();f.cleanup();}
});
test('one failed batch cancels sibling requests, retains streamed pages, and resumed book joins tail',async()=>{
 const f=fixture(15,3),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{f.books.forEach(b=>engine.resumeBook(b.id));c.calls[0].delta?.(rows([1]));c.calls[1].reject(Error('fixture network error'));await until(()=>f.books[0].generationPaused===true);assert.equal(f.books[0].pages[0].status,'done');assert.ok(c.calls[0].signal.aborted&&c.calls[2].signal.aborted);assert.equal(c.calls[1].settled,true);
 engine.resumeBook(f.books[0].id);await until(()=>c.calls.length>=6);assert.ok(c.calls.slice(3,6).every(call=>call.prompt.includes(`教材：${f.books[1].name}`)));c.calls[0].delta?.(rows([1,2]));assert.equal(f.books[0].pages[1].status,'pending');await drain(engine,c,f.books);assert.equal(f.books[0].pages[0].lesson,'講稿 1');assert.ok(!c.calls.slice(6).filter(c=>c.kind==='lesson').flatMap(c=>c.pages).includes(1));
 }finally{engine.stop();f.cleanup();}
});
test('pause and immediate resume drain cancelled leases before reserving new batches',async()=>{
 const f=fixture(15,3),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{engine.resumeBook(f.books[0].id);assert.equal(c.calls.length,3);engine.pauseBook(f.books[0].id);engine.resumeBook(f.books[0].id);assert.equal(c.calls.length,3);await until(()=>c.calls.length===6);assert.deepEqual(c.calls.slice(3).flatMap(c=>c.pages),Array.from({length:15},(_,i)=>i+1));assert.equal(c.max,3);await drain(engine,c,f.books);
 }finally{engine.stop();f.cleanup();}
});
test('manual questions and concept calls share global capacity; current-book question gets next available slot',async()=>{
 const f=fixture(20,2),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{engine.resumeBook(f.books[0].id);const answer=engine.ask(f.books[0].id,1,'優先問題');const review=engine.generateReview(f.books[0],new AbortController().signal,'manual concept',[],'test');assert.equal(c.calls.length,2);c.calls[1].resolve(rows(c.calls[1].pages));await until(()=>c.calls.length===3);assert.match(c.calls[2].prompt,/優先問題/);c.calls[2].resolve('回答');await answer;await until(()=>c.calls.some(c=>c.prompt==='manual concept'));const call=c.calls.find(c=>c.prompt==='manual concept')!;call.resolve('graph');await review;assert.ok(c.max<=2);await drain(engine,c,f.books);
 }finally{engine.stop();f.cleanup();}
});
test('unready earliest source does not get bypassed by a later page or another queued book',async()=>{
 const f=fixture(20,6),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{f.books[0].pages[0].imageReady=false;f.books.forEach(b=>engine.resumeBook(b.id));assert.equal(c.calls.length,0);f.books[0].pages[0].imageReady=true;engine.wake();assert.equal(c.calls.length,4);await drain(engine,c,f.books);}finally{engine.stop();f.cleanup();}
});

test('failed parallel index retains committed chunks and ignores a late cancelled index reply on resume',async()=>{
 const f=fixture(14,3,false),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{engine.resumeBook(f.books[0].id);assert.equal(c.calls.length,2);c.calls[0].resolve(response(c.calls[0],f.books[0]));await until(()=>c.calls.some(c=>c.kind==='lesson'));c.calls[1].reject(Error('index failure'));await until(()=>!!f.books[0].generationPaused);assert.equal(f.books[0].mapChunks.flat().length,5);
 engine.resumeBook(f.books[0].id);c.calls[1].resolve(response(c.calls[1],f.books[0]));await drain(engine,c,f.books);assert.equal(f.books[0].mapChunks.flat().length,14);assert.equal(new Set(f.books[0].mapChunks.flat().map(p=>p.page)).size,14);assert.equal(f.books[0].mapStatus,'done');assert.equal(c.calls.filter(c=>c.kind==='overview').length,1);
 }finally{engine.stop();f.cleanup();}
});
