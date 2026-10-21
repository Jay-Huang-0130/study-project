import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lessonGuide } from '../electron/lesson-style';
import { normalizeSettings } from '../electron/store';
import { Store } from '../electron/store';
import { Engine, nextPage, validateMapChunk, acceptsResult, type Provider } from '../electron/engine';
import type { Book } from '../src/shared';
import { PriorityPool } from '../electron/priority-pool';

function setup(count = 3) {
  const dir = mkdtempSync(path.join(os.tmpdir(),'study-test-'));
  const file = path.join(dir,'lecture.pdf'); writeFileSync(file,'%PDF-1.4\nfixture');
  const store = new Store(path.join(dir,'library')); const book = store.import(file);
  store.updateSettings({aiConcurrency:1});
  book.count = count; book.extraction = 'done'; book.extracted = count;
  book.pages = Array.from({length:count},(_,i) => ({ number:i+1,text:`原頁${i+1}`,width:100,height:100,imageReady:true,lesson:'',status:'pending',messages:[] }));
  store.save(book);
  return { dir,file,store,book, cleanup: () => rmSync(dir,{recursive:true,force:true}) };
}
function withMap(book: Book) {
  book.map = { version:'v1',overview:'全書摘要',terms:['A 的定義'],pages:book.pages.map(p => ({page:p.number,topic:'主題',summary:'摘要',terms:[],relatedPages:[]})) }; book.mapStatus='done';
}
async function until(predicate: () => boolean) {
  const start=Date.now(); while(!predicate()) { if(Date.now()-start>4000) throw new Error('Condition timed out'); await new Promise(r=>setTimeout(r,10)); }
}
test('renamed identical PDFs reuse records; same names with different bytes do not', () => {
  const f=setup(); try {
    const renamed=path.join(f.dir,'renamed.pdf'); writeFileSync(renamed,'%PDF-1.4\nfixture');
    assert.equal(f.store.import(renamed).id,f.book.id);
    writeFileSync(renamed,'%PDF-1.4\ndifferent'); assert.notEqual(f.store.import(renamed).id,f.book.id);
  } finally { f.cleanup(); }
});
test('restart preserves completed lessons and recovers interrupted jobs without marking partial answers done', () => {
  const f=setup(); try {
    f.book.pages[0].lesson='完成講稿'; f.book.pages[0].status='done'; f.book.pages[1].status='running';
    f.book.pages[1].messages.push({id:'m',question:'為什麼',answer:'部分回答',status:'running',kind:'question',createdAt:''});
    f.store.save(f.book); const restored=new Store(f.store.root).book(f.book.id);
    assert.equal(restored.pages[0].lesson,'完成講稿'); assert.equal(restored.pages[0].status,'done');
    assert.equal(restored.pages[1].status,'pending'); assert.equal(restored.pages[1].messages[0].status,'pending');
  } finally { f.cleanup(); }
});
test('page selection prioritizes a jump and the next pages; completed work is skipped', () => {
  const f=setup(100); try {
    f.book.currentPage=70; assert.equal(nextPage(f.book),70);
    f.book.pages[69].status='done'; assert.equal(nextPage(f.book),71);
    f.book.pages[70].status='running'; assert.equal(nextPage(f.book),72);
  } finally { f.cleanup(); }
});
test('map validation rejects missing and duplicate source pages', () => {
  const entry={page:1,topic:'t',summary:'s',terms:[],relatedPages:[2,999]};
  assert.throws(()=>validateMapChunk({pages:[entry]},[1,2],3));
  assert.throws(()=>validateMapChunk({pages:[entry,entry]},[1,2],3));
  assert.deepEqual(validateMapChunk({pages:[entry]},[1],3)[0].relatedPages,[2]);
});
test('completed lesson cannot be overwritten by an outdated map result', () => {
  const f=setup(); try { withMap(f.book); f.book.pages[0].status='running'; assert.equal(acceptsResult(f.book,1,'old'),false); assert.equal(acceptsResult(f.book,1,'v1'),true); f.book.pages[0].status='done'; assert.equal(acceptsResult(f.book,1,'v1'),false); } finally { f.cleanup(); }
});
test('in-flight lesson stays on original page after navigation; cache revisit makes no model call', async () => {
  const f=setup(); let engine:Engine|undefined;
  try {
    withMap(f.book); let calls=0; let release:(value:string)=>void=()=>{};
    const provider:Provider={generate:async()=>{calls++; return new Promise<string>(r=>release=r);}};
    engine=new Engine(f.store,provider,()=>{},()=>{}); engine.activeId=f.book.id; engine.authenticated=true; engine.wake();
    await until(()=>calls===1); f.book.currentPage=2; f.book.generationPaused=true; release('第一頁的講稿');
    await until(()=>f.book.pages[0].status==='done');
    assert.equal(f.book.pages[0].lesson,'第一頁的講稿'); assert.equal(f.book.pages[1].lesson,'');
    f.book.currentPage=1; engine.wake(); assert.equal(calls,1);
  } finally { engine?.stop(); f.cleanup(); }
});
test('question answer stays with submitted page while user changes pages', async () => {
  const f=setup(); let engine:Engine|undefined;
  try {
    withMap(f.book); let release:(value:string)=>void=()=>{};
    engine=new Engine(f.store,{generate:async()=>new Promise<string>(r=>release=r)},()=>{},()=>{}); engine.authenticated=true;
    const task=engine.ask(f.book.id,1,'為什麼？'); f.book.currentPage=3; release('因為原頁的定義。'); await task;
    assert.equal(f.book.pages[0].messages[0].answer,'因為原頁的定義。'); assert.equal(f.book.pages[2].messages.length,0);
  } finally { engine?.stop(); f.cleanup(); }
});
test('available pages get lessons and accept questions before remaining images or full map finish', async () => {
  const f=setup(8);let engine:Engine|undefined;
  try {
    f.book.extraction='running';for(const p of f.book.pages.slice(2))p.imageReady=false;
    const provider:Provider={generate:async(prompt,images,_model,_instructions,_delta,schema:any)=>{
      if(schema?.properties?.pages)return JSON.stringify({pages:images.map(file=>({page:Number(file.match(/p(\d+)\.jpg$/)![1]),topic:'概念',summary:'說明',terms:[],relatedPages:[]}))});
      if(prompt.includes('撰寫一對一')){f.book.generationPaused=true;return '第一頁已經可以閱讀';}
      return '可以先回答這一頁';
    }};
    engine=new Engine(f.store,provider,()=>{},()=>{});engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>f.book.pages[0].status==='done');
    assert.equal(f.book.extraction,'running');assert.equal(f.book.map?.complete,false);assert.equal(f.book.map?.pages.length,2);
    assert.equal(f.book.pages[0].contextComplete,false);assert.equal(f.book.pages[0].contextPages,2);
    f.book.generationPaused=false;await engine.ask(f.book.id,1,'這一頁可以先問嗎？');assert.equal(f.book.pages[0].messages[0].status,'done');
  }finally{engine?.stop();f.cleanup();}
});

test('current source image is retained even when many earlier pages are related', async () => {
  const f=setup(100); let engine:Engine|undefined;
  try {
    withMap(f.book); f.book.map!.pages[69].relatedPages=[1,2,3,4,5,6,7];
    let images:string[]=[];
    engine=new Engine(f.store,{generate:async(_prompt,input)=>{images=input;return '解釋';}},()=>{},()=>{});engine.authenticated=true;
    await engine.ask(f.book.id,70,'解釋這一頁');
    assert.ok(images[0].endsWith('p70.jpg'));assert.ok(images.some(p=>p.endsWith('p69.jpg')));
  } finally {engine?.stop();f.cleanup();}
});
test('exercise answers retain original selected source pages in later follow-up', async () => {
  const f=setup(12); let engine:Engine|undefined;
  try {
    withMap(f.book); const inputs:string[][]=[];
    engine=new Engine(f.store,{generate:async(_prompt,images)=>{inputs.push(images);return '練習與回饋';}},()=>{},()=>{});engine.authenticated=true;
    await engine.ask(f.book.id,2,'請出三題','exercise',{start:2,end:8,count:3});
    await engine.ask(f.book.id,2,'我的答案是 A');
    assert.deepEqual(f.book.pages[1].messages[0].sourcePages,[2,3,4,5,6,7,8]);
    for(const n of [2,3,4,5,6,7,8])assert.ok(inputs[1].some(p=>p.endsWith(`p${n}.jpg`)));
  } finally {engine?.stop();f.cleanup();}
});
test('a fully cached book issues no model request even with generation enabled', async () => {
  const f=setup(); let engine:Engine|undefined;
  try {
    withMap(f.book);for(const p of f.book.pages){p.status='done';p.lesson='已保存';}
    let calls=0;engine=new Engine(f.store,{generate:async()=>{calls++;return 'unexpected';}},()=>{},()=>{});
    engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    assert.equal(calls,0);assert.equal(engine.activity,'本教材講解已準備完成');
  } finally {engine?.stop();f.cleanup();}
});
test('repeated provider failures pause background work instead of failing every remaining page', async () => {
  const f=setup(20); let engine:Engine|undefined;
  try {
    withMap(f.book);let calls=0;
    engine=new Engine(f.store,{generate:async()=>{calls++;throw new Error('Provider rejected request');}},()=>{},()=>{});
    engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>f.book.generationPaused===true);
    assert.equal(calls,1);assert.equal(f.book.pages.filter(p=>p.status==='pending').length,20);
    assert.equal(f.book.generationPaused,true);
  } finally {engine?.stop();f.cleanup();}
});
test('shutdown returns interrupted lessons to pending for automatic continuation', async () => {
  const f=setup();let engine:Engine|undefined;
  try {
    withMap(f.book);let reject:(error:Error)=>void=()=>{};
    engine=new Engine(f.store,{generate:async()=>new Promise<string>((_resolve,r)=>reject=r)},()=>{},()=>{});
    engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>f.book.pages[0].status==='running');engine.stop();reject(new Error('Connection closed'));
    await until(()=>f.book.pages[0].status==='pending');
    assert.equal(new Store(f.store.root).book(f.book.id).pages[0].status,'pending');
    assert.equal(f.store.settings.paused,false);
  } finally {engine?.stop();f.cleanup();}
});
test('indexing starts with the page the reader jumped to rather than assuming a contiguous prefix',async()=>{
  const f=setup(100);let engine:Engine|undefined;
  try{
    f.book.currentPage=70;
    const provider:Provider={generate:async(_prompt,images)=>{
      f.book.generationPaused=true;
      return JSON.stringify({pages:images.map(file=>({page:Number(file.match(/p(\d+)\.jpg$/)![1]),topic:'概念',summary:'說明',terms:[],relatedPages:[]}))});
    }};
    engine=new Engine(f.store,provider,()=>{},()=>{});engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>!!f.book.map);assert.deepEqual(f.book.map!.pages.map(p=>p.page),[70,71]);
    assert.equal(f.book.mapChunks.flat().length,2);
  }finally{engine?.stop();f.cleanup();}
});
test('a final map arriving during a lesson preserves that answer and its partial-context provenance',async()=>{
  const f=setup(4);let engine:Engine|undefined;
  try{
    f.store.updateSettings({aiConcurrency:2});
    withMap(f.book);f.book.map!.complete=false;f.book.map!.pages=f.book.map!.pages.slice(0,2);f.book.mapChunks=[f.book.map!.pages];f.book.mapStatus='running';
    let finishLesson:(text:string)=>void=()=>{};
    const provider:Provider={generate:async(prompt,images,_model,_instructions,_delta,schema:any)=>{
      if(schema?.properties?.pages)return JSON.stringify({pages:images.map(file=>({page:Number(file.match(/p(\d+)\.jpg$/)![1]),topic:'概念',summary:'說明',terms:[],relatedPages:[]}))});
      if(schema?.properties?.links){f.book.generationPaused=true;return JSON.stringify({overview:'全書完成',terms:[],links:[1,2,3,4].map(page=>({page,relatedPages:[]}))});}
      return new Promise<string>(resolve=>finishLesson=resolve);
    }};
    engine=new Engine(f.store,provider,()=>{},()=>{});engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>f.book.mapStatus==='done');finishLesson('原頁講解，不應因地圖擴充而丟失');
    await until(()=>f.book.pages[0].status==='done');
    assert.equal(f.book.pages[0].contextComplete,false);assert.equal(f.book.pages[0].contextPages,2);
    assert.equal(f.book.pages[0].lesson,'原頁講解，不應因地圖擴充而丟失');
  }finally{engine?.stop();f.cleanup();}
});
test('question requests overtake queued background work and total provider concurrency stays at two',async()=>{
  const pool=new PriorityPool(2);const starts:string[]=[];let active=0,maxActive=0;
  const releases=new Map<string,()=>void>();
  const task=(name:string)=>async()=>{starts.push(name);active++;maxActive=Math.max(maxActive,active);await new Promise<void>(resolve=>releases.set(name,resolve));active--;return name;};
  const a=pool.run(2,task('index')),b=pool.run(1,task('lesson')),c=pool.run(2,task('background')),q=pool.run(0,task('question'));
  releases.get('index')!();await a;await until(()=>starts.length===3);assert.equal(starts[2],'question');
  releases.get('lesson')!();await b;await until(()=>starts.length===4);releases.get('question')!();releases.get('background')!();await Promise.all([q,c]);assert.equal(maxActive,2);
});
test('an old partially analyzed book exposes its saved index immediately without another model request',()=>{
  const f=setup(8);let engine:Engine|undefined;
  try{
    f.book.mapChunks=[[{page:1,topic:'已分析',summary:'既有紀錄',terms:[],relatedPages:[]}]];
    let calls=0;engine=new Engine(f.store,{generate:async()=>{calls++;return '';}},()=>{},()=>{});engine.activeId=f.book.id;engine.wake();
    assert.equal(f.book.map?.pages[0].topic,'已分析');assert.equal(f.book.map?.complete,false);assert.equal(calls,0);
  }finally{engine?.stop();f.cleanup();}
});


test('legacy settings migrate to bounded parallelism and concise lessons',()=>{
  assert.deepEqual(normalizeSettings({model:'saved',paused:true}),{model:'saved',paused:true,aiConcurrency:4,pdfWorkers:2,lessonDetail:'concise'});
  const bad=normalizeSettings({aiConcurrency:99,pdfWorkers:0,lessonDetail:'bad' as any});
  assert.equal(bad.aiConcurrency,4);assert.equal(bad.pdfWorkers,2);assert.equal(bad.lessonDetail,'concise');
});
test('four lessons overlap, finish out of order, and remain attached to original pages',async()=>{
  const f=setup(6);let engine:Engine|undefined;
  try{
    withMap(f.book);f.store.updateSettings({aiConcurrency:4});const releases=new Map<number,(text:string)=>void>();
    engine=new Engine(f.store,{generate:async(prompt)=>{
      const n=Number(prompt.match(/針對第 (\d+) 頁撰寫/)![1]);
      return new Promise<string>(resolve=>releases.set(n,resolve));
    }},()=>{},()=>{});engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>releases.size===4);assert.equal(engine.progress.modelActive,4);assert.equal(engine.progress.activeLessons,4);
    f.book.generationPaused=true;f.book.currentPage=6;
    for(const n of [4,2,3,1]){releases.get(n)!(`page ${n}`);await until(()=>f.book.pages[n-1].status==='done');}
    for(const n of [1,2,3,4]){assert.equal(f.book.pages[n-1].lesson,`page ${n}`);assert.equal(f.book.pages[n-1].lessonDetail,'concise');}
    assert.equal(f.book.pages[5].status,'pending');
  }finally{engine?.stop();f.cleanup();}
});
test('live pool resizing preserves active requests and queued question priority',async()=>{
  const pool=new PriorityPool(1);const starts:string[]=[];const releases=new Map<string,()=>void>();
  const task=(name:string)=>pool.run(name==='question'?0:2,async()=>{starts.push(name);await new Promise<void>(r=>releases.set(name,r));});
  const jobs=[task('first'),task('background'),task('question')];pool.setCapacity(2);
  assert.deepEqual(starts,['first','question']);pool.setCapacity(1);releases.get('first')!();await jobs[0];
  assert.deepEqual(starts,['first','question']);releases.get('question')!();await jobs[2];await until(()=>starts.length===3);
  releases.get('background')!();await jobs[1];
});
test('lesson prompts adapt density without forcing filler or removing necessary steps',()=>{
  const f=setup();try{
    withMap(f.book);f.book.map!.pages[0].density='brief';f.book.map!.pages[1].density='dense';
    assert.match(lessonGuide(f.book,1,'concise'),/40～120/);assert.match(lessonGuide(f.book,2,'concise'),/300～600/);
    assert.match(lessonGuide(f.book,1,'detailed'),/簡單頁仍然簡短/);assert.match(lessonGuide(f.book,1,'concise'),/不可為縮短字數而省略必要定義/);
  }finally{f.cleanup();}
});


test('deleting one exchange persists across restart without changing lessons or other pages',()=>{
  const f=setup();try{
    const message=(id:string)=>({id,question:id,answer:'回答',status:'done' as const,kind:'question' as const,createdAt:''});
    f.book.pages[0].lesson='講稿';f.book.pages[0].status='done';f.book.pages[0].messages=[message('remove'),message('keep')];
    f.book.pages[1].messages=[message('other-page')];f.store.save(f.book);
    f.store.deleteMessage(f.book.id,1,'remove');
    const restored=new Store(f.store.root).book(f.book.id);
    assert.deepEqual(restored.pages[0].messages.map(m=>m.id),['keep']);assert.equal(restored.pages[0].lesson,'講稿');
    assert.deepEqual(restored.pages[1].messages.map(m=>m.id),['other-page']);
  }finally{f.cleanup();}
});
test('deletion rejects active exchanges, wrong page and unknown IDs',()=>{
  const f=setup();try{
    f.book.pages[0].messages=[{id:'active',question:'問題',answer:'部分回答',status:'running',kind:'question',createdAt:''}];
    assert.throws(()=>f.store.deleteMessage(f.book.id,1,'active'),/等待回答完成/);
    assert.throws(()=>f.store.deleteMessage(f.book.id,2,'active'),/找不到/);
    assert.throws(()=>f.store.deleteMessage(f.book.id,0,'active'),/頁碼/);
    assert.throws(()=>f.store.deleteMessage(f.book.id,1,'missing'),/找不到/);
    assert.equal(f.book.pages[0].messages.length,1);
  }finally{f.cleanup();}
});
test('deleted exercises and failed exchanges are absent from later model context',async()=>{
  const f=setup();let engine:Engine|undefined;
  try{
    withMap(f.book);f.book.pages[0].messages=[
      {id:'exercise',question:'deleted exercise marker',answer:'舊練習',status:'done',kind:'exercise',sourcePages:[1,2,3],createdAt:''},
      {id:'failed',question:'失敗問題',answer:'',status:'error',kind:'question',createdAt:''}];
    f.store.deleteMessage(f.book.id,1,'exercise');f.store.deleteMessage(f.book.id,1,'failed');
    let prompt='';engine=new Engine(f.store,{generate:async(input)=>{prompt=input;return '新回答';}},()=>{},()=>{});engine.authenticated=true;
    await engine.ask(f.book.id,1,'新問題');assert.ok(!prompt.includes('deleted exercise marker'));
    assert.equal(f.book.pages[0].messages.length,1);assert.equal(f.book.pages[0].messages[0].question,'新問題');
  }finally{engine?.stop();f.cleanup();}
});


test('deleting a book removes its library files and history but keeps the source and other books',()=>{
  const f=setup();try{
    const old=f.book;old.pages[0].messages=[{id:'m',question:'q',answer:'a',kind:'question',status:'done',createdAt:''}];f.store.save(old);
    const otherFile=path.join(f.dir,'other.pdf');writeFileSync(otherFile,'%PDF-1.4 other');const other=f.store.import(otherFile);
    const removedDir=f.store.dir(old.id);f.store.deleteBook(old.id);
    assert.equal(existsSync(removedDir),false);assert.equal(existsSync(f.file),true);assert.equal(existsSync(f.store.dir(other.id)),true);
    assert.deepEqual(new Store(f.store.root).summaries().map(b=>b.id),[other.id]);
    f.store.save(old);assert.equal(existsSync(removedDir),false);
    const fresh=f.store.import(f.file);assert.equal(fresh.pages.length,0);f.store.save(old);
    assert.equal(new Store(f.store.root).book(fresh.id).pages.length,0);
  }finally{f.cleanup();}
});
test('a late lesson after book deletion cannot recreate files or overwrite a reimport',async()=>{
  const f=setup();let engine:Engine|undefined;
  try{
    withMap(f.book);let finish:(text:string)=>void=()=>{};
    engine=new Engine(f.store,{generate:async()=>new Promise<string>(r=>finish=r)},()=>{},()=>{});engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>engine!.progress.modelActive===1);const id=f.book.id,dir=f.store.dir(id);
    engine.activeId=undefined;f.store.deleteBook(id);const fresh=f.store.import(f.file);finish('deleted lesson must not return');
    await until(()=>engine!.progress.activeLessons===0);
    assert.equal(f.store.book(id),fresh);assert.equal(new Store(f.store.root).book(id).pages.length,0);
    assert.equal(f.store.settings.paused,false);assert.equal(existsSync(dir),true);
  }finally{engine?.stop();f.cleanup();}
});
test('a late index result cannot recreate a deleted book',async()=>{
  const f=setup();let engine:Engine|undefined;
  try{
    let finish:(text:string)=>void=()=>{};engine=new Engine(f.store,{generate:async()=>new Promise<string>(r=>finish=r)},()=>{},()=>{});engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>engine!.progress.modelActive===1);const dir=f.store.dir(f.book.id);engine.activeId=undefined;f.store.deleteBook(f.book.id);
    finish(JSON.stringify({pages:[1,2].map(page=>({page,topic:'topic',summary:'summary',terms:[],relatedPages:[]}))}));
    await until(()=>!engine!.progress.indexing);assert.equal(existsSync(dir),false);assert.equal(f.store.summaries().length,0);
  }finally{engine?.stop();f.cleanup();}
});


test('pause aborts all page requests immediately; resume retries only unfinished pages and ignores late answers',async()=>{
  const f=setup(4);let engine:Engine|undefined;
  try{
    withMap(f.book);f.store.updateSettings({aiConcurrency:2});f.book.pages[3].status='done';f.book.pages[3].lesson='cached';
    const releases:Array<(s:string)=>void>=[],signals:AbortSignal[]=[];let calls=0;
    engine=new Engine(f.store,{generate:async(_p,_i,_m,_r,_d,_s,signal)=>{calls++;signals.push(signal!);return new Promise<string>(r=>releases.push(r));}},()=>{},()=>{});engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>calls===2);engine.pauseBook(f.book.id);assert.ok(signals.every(s=>s.aborted));assert.equal(f.book.pages.filter(p=>p.status==='running').length,0);
    await until(()=>engine!.progress.modelActive===0);for(const release of releases)release('old result');
    await new Promise(r=>setTimeout(r,40));assert.equal(calls,2);assert.equal(f.book.pages[0].lesson,'');assert.equal(f.book.pages[3].lesson,'cached');
    engine.resumeBook(f.book.id);await until(()=>calls===4);releases[2]('new 1');releases[3]('new 2');await until(()=>calls===5);releases[4]('new 3');await until(()=>engine!.bookState(f.book)==='complete');
    assert.equal(f.book.pages[0].lesson,'new 1');assert.equal(f.book.pages[3].lesson,'cached');
  }finally{engine?.stop();f.cleanup();}
});
function anotherBook(f:ReturnType<typeof setup>){
  const file=path.join(f.dir,'second.pdf');writeFileSync(file,'%PDF-1.4 second');const book=f.store.import(file);book.count=1;book.extraction='done';book.extracted=1;
  book.pages=[{number:1,text:'第二份',width:100,height:100,imageReady:true,lesson:'',status:'pending',messages:[]}];withMap(book);return book;
}
test('switching books keeps earlier work running; each book has independent pause and total concurrency is bounded',async()=>{
  const f=setup(2);let engine:Engine|undefined;
  try{
    withMap(f.book);const second=anotherBook(f);second.generationPaused=true;f.store.updateSettings({aiConcurrency:2});const releases:Array<()=>void>=[];
    engine=new Engine(f.store,{generate:async()=>new Promise<string>(r=>releases.push(()=>r('完成')))},()=>{},()=>{});engine.authenticated=true;engine.activeId=f.book.id;engine.wake();await until(()=>releases.length===2);
    engine.activeId=second.id;engine.wake();assert.equal(engine.bookState(f.book),'running');assert.equal(engine.bookState(second),'paused');
    releases[0]();releases[1]();await until(()=>engine!.bookState(f.book)==='complete');assert.equal(second.pages[0].status,'pending');
    engine.resumeBook(second.id);await until(()=>releases.length===3);assert.ok(engine.progress.modelActive<=2);releases[2]();await until(()=>engine!.bookState(second)==='complete');
  }finally{engine?.stop();f.cleanup();}
});
test('quota failure pauses just that book and one resume retries the failed page',async()=>{
  const f=setup(1);let engine:Engine|undefined;
  try{
    withMap(f.book);const second=anotherBook(f);second.generationStarted=true;f.store.updateSettings({aiConcurrency:2});let failures=0;
    engine=new Engine(f.store,{generate:async prompt=>{if(prompt.includes(`教材：${f.book.name}`)&&failures++===0)throw new Error('usage limit reached');return '完成';}},()=>{},()=>{});engine.authenticated=true;engine.activeId=f.book.id;engine.wake();
    await until(()=>f.book.generationPaused===true&&second.pages[0].status==='done');assert.match(f.book.pauseReason!,/usage limit/);assert.equal(second.generationPaused,false);
    engine.resumeBook(f.book.id);await until(()=>f.book.pages[0].status==='done');assert.equal(f.book.generationPaused,false);
  }finally{engine?.stop();f.cleanup();}
});
test('offline interruption persists per-book pause and unfinished work across restart',async()=>{
  const f=setup(1);let engine:Engine|undefined;
  try{
    withMap(f.book);engine=new Engine(f.store,{generate:async()=>new Promise<string>(()=>{})},()=>{},()=>{});engine.authenticated=true;engine.activeId=f.book.id;engine.wake();
    await until(()=>engine!.progress.modelActive===1);engine.connectionLost('network offline');await until(()=>engine!.progress.modelActive===0);
    const restored=new Store(f.store.root).book(f.book.id);assert.equal(restored.generationPaused,true);assert.match(restored.pauseReason!,/network offline/);assert.equal(restored.pages[0].status,'pending');
  }finally{engine?.stop();f.cleanup();}
});
test('a failed question resumes in the same record without duplicating history',async()=>{
  const f=setup(1);let engine:Engine|undefined;
  try{
    withMap(f.book);f.book.pages[0].status='done';f.book.pages[0].lesson='saved lesson';let calls=0;
    engine=new Engine(f.store,{generate:async()=>{if(++calls===1)throw new Error('quota exceeded');return 'recovered answer';}},()=>{},()=>{});engine.authenticated=true;
    await engine.ask(f.book.id,1,'原問題');assert.equal(f.book.generationPaused,true);const id=f.book.pages[0].messages[0].id;
    engine.resumeBook(f.book.id);await until(()=>f.book.pages[0].messages[0].status==='done');assert.equal(f.book.pages[0].messages.length,1);assert.equal(f.book.pages[0].messages[0].id,id);assert.equal(f.book.pages[0].messages[0].answer,'recovered answer');
  }finally{engine?.stop();f.cleanup();}
});
test('a cancelled queued request never reaches the provider',async()=>{
  const pool=new PriorityPool(1);let release:()=>void=()=>{},started=false;const controller=new AbortController();
  const first=pool.run(1,async()=>new Promise<void>(r=>release=r));
  const queued=pool.run(1,async()=>{started=true;},controller.signal);controller.abort();await assert.rejects(queued,{name:'AbortError'});release();await first;assert.equal(started,false);
});


test('normal shutdown disconnect does not turn running books into a persisted error pause',()=>{
  const f=setup();let engine:Engine|undefined;try{
    engine=new Engine(f.store,{generate:async()=>''},()=>{},()=>{});engine.activeId=f.book.id;engine.stop();engine.connectionLost('normal process close');
    assert.equal(f.book.generationPaused,false);assert.equal(new Store(f.store.root).book(f.book.id).generationPaused,false);
  }finally{engine?.stop();f.cleanup();}
});
