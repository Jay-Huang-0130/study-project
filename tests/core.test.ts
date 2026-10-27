import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lessonGuide } from '../electron/lesson-style';
import { normalizeSettings } from '../electron/store';
import { Store } from '../electron/store';
import { Engine as BaseEngine, nextPage, nextIndexPages, validateMapChunk, acceptsResult, type Provider } from '../electron/engine';
import type { Book } from '../src/shared';
import { PriorityPool } from '../electron/priority-pool';

// Timing is verified separately with controlled clocks; workflow fixtures skip real cooldowns.
class Engine extends BaseEngine { constructor(...args:ConstructorParameters<typeof BaseEngine>){super(args[0],args[1],args[2],args[3],args[4],0);} }

function batchReply(prompt:string,lesson:string){
 const match=prompt.match(/唯一目標頁碼（依序）：([\d、]+)/);return match?match[1].split('、').map(n=>JSON.stringify({page:Number(n),lesson})).join('\n'):lesson;
}
function setup(count = 3) {
  const dir = mkdtempSync(path.join(os.tmpdir(),'study-test-'));
  const file = path.join(dir,'lecture.pdf'); writeFileSync(file,'%PDF-1.4\nfixture');
  const store = new Store(path.join(dir,'library')); const book = store.import(file);
  store.updateSettings({aiConcurrency:1});
  book.generationPaused=false;
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
test('lesson selection stays in ascending order after a jump and waits for the earliest missing prerequisites', () => {
  const f=setup(100); try {
    f.book.currentPage=70; assert.equal(nextPage(f.book),1);
    f.book.pages[0].status='done'; assert.equal(nextPage(f.book),2);
    f.book.pages[1].status='running'; assert.equal(nextPage(f.book),3);
    f.book.pages[2].imageReady=false;assert.equal(nextPage(f.book),undefined);
    f.book.pages[2].imageReady=true;withMap(f.book);f.book.map!.pages=f.book.map!.pages.filter(p=>p.page!==3);assert.equal(nextPage(f.book),undefined);
  } finally { f.cleanup(); }
});
test('index batches fill earliest holes and do not jump past an image still loading',()=>{
 const f=setup(8);try{
  const entry=(page:number)=>({page,topic:'t',summary:'s',terms:[],relatedPages:[]});
  f.book.currentPage=8;f.book.mapChunks=[[entry(1),entry(4),entry(6)]];
  f.book.pages[1].imageReady=false;assert.deepEqual(nextIndexPages(f.book,6),[]);
  f.book.pages[1].imageReady=true;assert.deepEqual(nextIndexPages(f.book,2),[2,3]);
  f.book.pages[4].imageReady=false;assert.deepEqual(nextIndexPages(f.book,6),[2,3]);
  f.book.pages[4].imageReady=true;assert.deepEqual(nextIndexPages(f.book,6),[2,3,5,7,8]);
 }finally{f.cleanup();}
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
    engine=new Engine(f.store,provider,()=>{},()=>{}); engine.activeId=f.book.id;f.book.generationStarted=true; engine.authenticated=true; engine.wake();
    await until(()=>calls===1); f.book.currentPage=2; f.book.generationPaused=true; release(JSON.stringify({page:1,lesson:'第一頁的講稿'}));
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
      if(prompt.includes('撰寫一對一')){f.book.generationPaused=true;return batchReply(prompt,'第一頁已經可以閱讀');}
      return '可以先回答這一頁';
    }};
    engine=new Engine(f.store,provider,()=>{},()=>{});engine.activeId=f.book.id;f.book.generationStarted=true;engine.authenticated=true;engine.wake();
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
    engine.activeId=f.book.id;f.book.generationStarted=true;engine.authenticated=true;engine.wake();
    assert.equal(calls,0);assert.equal(engine.activity,'本教材講解已準備完成');
  } finally {engine?.stop();f.cleanup();}
});
test('repeated provider failures pause background work instead of failing every remaining page', async () => {
  const f=setup(20); let engine:Engine|undefined;
  try {
    withMap(f.book);let calls=0;
    engine=new Engine(f.store,{generate:async()=>{calls++;throw new Error('Provider rejected request');}},()=>{},()=>{});
    engine.activeId=f.book.id;f.book.generationStarted=true;engine.authenticated=true;engine.wake();
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
    engine.activeId=f.book.id;f.book.generationStarted=true;engine.authenticated=true;engine.wake();
    await until(()=>f.book.pages[0].status==='running');engine.stop();reject(new Error('Connection closed'));
    await until(()=>f.book.pages[0].status==='pending');
    assert.equal(new Store(f.store.root).book(f.book.id).pages[0].status,'pending');
    assert.equal(f.store.settings.paused,false);
  } finally {engine?.stop();f.cleanup();}
});
test('indexing starts from the first page even when the reader has jumped ahead',async()=>{
  const f=setup(100);let engine:Engine|undefined;
  try{
    f.book.currentPage=70;
    const provider:Provider={generate:async(_prompt,images)=>{
      f.book.generationPaused=true;
      return JSON.stringify({pages:images.map(file=>({page:Number(file.match(/p(\d+)\.jpg$/)![1]),topic:'概念',summary:'說明',terms:[],relatedPages:[]}))});
    }};
    engine=new Engine(f.store,provider,()=>{},()=>{});engine.activeId=f.book.id;f.book.generationStarted=true;engine.authenticated=true;engine.wake();
    await until(()=>!!f.book.map);assert.deepEqual(f.book.map!.pages.map(p=>p.page),[1,2,3,4,5]);
    assert.equal(f.book.mapChunks.flat().length,5);
  }finally{engine?.stop();f.cleanup();}
});
test('an additive map update during a batch preserves original context provenance',async()=>{
 const f=setup(2);let engine:Engine|undefined;try{
  withMap(f.book);f.book.map!.complete=false;let finish:(s:string)=>void=()=>{};
  engine=new Engine(f.store,{generate:async()=>new Promise<string>(r=>finish=r)},()=>{},()=>{});engine.authenticated=true;f.book.generationStarted=true;engine.wake();
  await until(()=>engine!.progress.modelActive===1);f.book.map!.version='v2';f.book.map!.complete=true;f.book.generationPaused=true;
  finish([1,2].map(page=>JSON.stringify({page,lesson:'原頁講解'})).join('\n'));await until(()=>f.book.pages[0].status==='done');
  assert.equal(f.book.pages[0].contextComplete,false);assert.equal(f.book.pages[0].contextPages,2);assert.equal(f.book.pages[0].lesson,'原頁講解');
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
    let calls=0;engine=new Engine(f.store,{generate:async()=>{calls++;return '';}},()=>{},()=>{});engine.activeId=f.book.id;f.book.generationStarted=true;engine.wake();
    assert.equal(f.book.map?.pages[0].topic,'已分析');assert.equal(f.book.map?.complete,false);assert.equal(calls,0);
  }finally{engine?.stop();f.cleanup();}
});


test('legacy settings migrate to bounded parallelism and concise lessons',()=>{
  assert.deepEqual(normalizeSettings({model:'saved',paused:true}),{model:'saved',paused:true,aiConcurrency:1,pdfWorkers:2,lessonDetail:'concise',uiScale:100,readingFontSize:13});
  const bad=normalizeSettings({aiConcurrency:99,pdfWorkers:0,lessonDetail:'bad' as any});
  assert.equal(bad.aiConcurrency,1);assert.equal(bad.pdfWorkers,2);assert.equal(bad.lessonDetail,'concise');
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
    engine=new Engine(f.store,{generate:async()=>new Promise<string>(r=>finish=r)},()=>{},()=>{});engine.activeId=f.book.id;f.book.generationStarted=true;engine.authenticated=true;engine.wake();
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
    let finish:(text:string)=>void=()=>{};engine=new Engine(f.store,{generate:async()=>new Promise<string>(r=>finish=r)},()=>{},()=>{});engine.activeId=f.book.id;f.book.generationStarted=true;engine.authenticated=true;engine.wake();
    await until(()=>engine!.progress.modelActive===1);const dir=f.store.dir(f.book.id);engine.activeId=undefined;f.store.deleteBook(f.book.id);
    finish(JSON.stringify({pages:[1,2].map(page=>({page,topic:'topic',summary:'summary',terms:[],relatedPages:[]}))}));
    await until(()=>!engine!.progress.indexing);assert.equal(existsSync(dir),false);assert.equal(f.store.summaries().length,0);
  }finally{engine?.stop();f.cleanup();}
});


function anotherBook(f:ReturnType<typeof setup>){
  const file=path.join(f.dir,'second.pdf');writeFileSync(file,'%PDF-1.4 second');const book=f.store.import(file);book.generationPaused=false;book.count=1;book.extraction='done';book.extracted=1;
  book.pages=[{number:1,text:'第二份',width:100,height:100,imageReady:true,lesson:'',status:'pending',messages:[]}];withMap(book);return book;
}
test('switching books keeps earlier serial batch running; each book has independent pause',async()=>{
  const f=setup(2);let engine:Engine|undefined;
  try{
    withMap(f.book);const second=anotherBook(f);second.generationPaused=true;f.store.updateSettings({aiConcurrency:2});const releases:Array<()=>void>=[];
    engine=new Engine(f.store,{generate:async prompt=>new Promise<string>(r=>releases.push(()=>r(batchReply(prompt,'完成'))))},()=>{},()=>{});engine.authenticated=true;engine.activeId=f.book.id;f.book.generationStarted=true;engine.wake();await until(()=>releases.length===1);
    engine.activeId=second.id;engine.wake();assert.equal(engine.bookState(f.book),'running');assert.equal(engine.bookState(second),'paused');
    releases[0]();await until(()=>engine!.bookState(f.book)==='complete');assert.equal(second.pages[0].status,'pending');
    engine.resumeBook(second.id);await until(()=>releases.length===2);assert.ok(engine.progress.modelActive<=1);releases[1]();await until(()=>engine!.bookState(second)==='complete');
  }finally{engine?.stop();f.cleanup();}
});
test('quota failure pauses just that book and one resume retries the failed page',async()=>{
  const f=setup(1);let engine:Engine|undefined;
  try{
    withMap(f.book);const second=anotherBook(f);second.generationStarted=true;f.store.updateSettings({aiConcurrency:2});let failures=0;
    engine=new Engine(f.store,{generate:async prompt=>{if(prompt.includes(`教材：${f.book.name}`)&&failures++===0)throw new Error('usage limit reached');return batchReply(prompt,'完成');}},()=>{},()=>{});engine.authenticated=true;engine.activeId=f.book.id;f.book.generationStarted=true;engine.wake();
    await until(()=>f.book.generationPaused===true&&second.pages[0].status==='done');assert.match(f.book.pauseReason!,/usage limit/);assert.equal(second.generationPaused,false);
    engine.resumeBook(f.book.id);await until(()=>f.book.pages[0].status==='done');assert.equal(f.book.generationPaused,false);
  }finally{engine?.stop();f.cleanup();}
});
test('offline interruption persists per-book pause and unfinished work across restart',async()=>{
  const f=setup(1);let engine:Engine|undefined;
  try{
    withMap(f.book);engine=new Engine(f.store,{generate:async()=>new Promise<string>(()=>{})},()=>{},()=>{});engine.authenticated=true;engine.activeId=f.book.id;f.book.generationStarted=true;engine.wake();
    await until(()=>engine!.progress.modelActive===1);engine.connectionLost('network offline');await until(()=>engine!.progress.modelActive===0);
    const restored=new Store(f.store.root).book(f.book.id);assert.equal(restored.generationPaused,true);assert.equal(restored.generationStarted,false);assert.match(restored.pauseReason!,/手動/);assert.equal(restored.pages[0].status,'pending');
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
    engine=new Engine(f.store,{generate:async()=>''},()=>{},()=>{});engine.activeId=f.book.id;f.book.generationStarted=true;engine.stop();engine.connectionLost('normal process close');
    assert.equal(f.book.generationPaused,false);assert.equal(new Store(f.store.root).book(f.book.id).generationPaused,true);
  }finally{engine?.stop();f.cleanup();}
});


test('startup and selecting a legacy running book never enroll it for automatic generation',()=>{
  const f=setup(3);let engine:Engine|undefined;
  try{
    withMap(f.book);f.book.generationStarted=true;f.book.generationPaused=false;f.store.save(f.book);
    const store=new Store(f.store.root),book=store.book(f.book.id);let calls=0;
    engine=new Engine(store,{generate:async()=>{calls++;return 'unexpected';}},()=>{},()=>{});engine.authenticated=true;engine.activeId=book.id;engine.wake();
    store.updateSettings({aiConcurrency:6});engine.wake();assert.equal(calls,0);assert.equal(book.generationStarted,false);assert.equal(book.generationPaused,true);assert.equal(engine.bookState(book),'paused');
  }finally{engine?.stop();f.cleanup();}
});
test('one explicit resume repairs legacy quota errors and finishes missing index and lessons without regenerating cache',async()=>{
  const f=setup(4);let engine:Engine|undefined;
  try{
    withMap(f.book);f.book.map!.pages=f.book.map!.pages.slice(0,2);f.book.map!.complete=false;f.book.mapChunks=[f.book.map!.pages];f.book.mapStatus='error';f.book.mapError='old quota';
    f.book.pages[0].status='done';f.book.pages[0].lesson='cached lesson';for(const p of f.book.pages.slice(1)){p.status='error';p.error='old usage limit';}
    f.book.generationStarted=true;f.store.save(f.book);const store=new Store(f.store.root),book=store.book(f.book.id);let calls=0;
    engine=new Engine(store,{generate:async(_prompt,images,_model,_instructions,_delta,schema:any)=>{
      calls++;if(schema?.properties?.pages)return JSON.stringify({pages:images.map(file=>({page:Number(file.match(/p(\d+)\.jpg$/)![1]),topic:'主題',summary:'重點',terms:[],relatedPages:[],density:'brief'}))});
      if(schema?.properties?.links)return JSON.stringify({overview:'完整',terms:[],links:[1,2,3,4].map(page=>({page,relatedPages:[]}))});return batchReply(_prompt,'new lesson');
    }},()=>{},()=>{});engine.authenticated=true;engine.activeId=book.id;engine.wake();assert.equal(calls,0);
    engine.resumeBook(book.id);await until(()=>engine!.bookState(book)==='complete');assert.equal(book.pages[0].lesson,'cached lesson');assert.equal(book.pages.filter(p=>p.status==='done').length,4);assert.equal(book.mapStatus,'done');assert.equal(book.mapError,undefined);
  }finally{engine?.stop();f.cleanup();}
});
test('legacy error states report paused rather than a false running state with zero work',()=>{
  const f=setup();let engine:Engine|undefined;
  try{
    withMap(f.book);f.book.pages[1].status='error';f.book.pages[1].error='old quota';f.book.generationStarted=true;let calls=0;
    engine=new Engine(f.store,{generate:async()=>{calls++;return '';}},()=>{},()=>{});engine.authenticated=true;engine.activeId=f.book.id;engine.wake();assert.equal(calls,0);assert.equal(engine.bookState(f.book),'paused');
  }finally{engine?.stop();f.cleanup();}
});


test('manual resume clears stale error text even when legacy statuses already say pending',()=>{
  const f=setup(2);let engine:Engine|undefined;try{
    withMap(f.book);f.book.mapError='stale map quota';f.book.extractionError='stale extraction error';for(const p of f.book.pages)p.error='stale page quota';
    engine=new Engine(f.store,{generate:async()=>new Promise<string>(()=>{})},()=>{},()=>{});engine.authenticated=true;engine.resumeBook(f.book.id);
    assert.equal(f.book.mapError,undefined);assert.equal(f.book.extractionError,undefined);assert.ok(f.book.pages.every(p=>p.error===undefined));
  }finally{engine?.stop();f.cleanup();}
});
