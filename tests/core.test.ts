import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
    assert.equal(restored.pages[1].status,'pending'); assert.equal(restored.pages[1].messages[0].status,'error');
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
    await until(()=>calls===1); f.book.currentPage=2; f.store.settings.paused=true; release('第一頁的講稿');
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
      if(prompt.includes('撰寫一對一')){f.store.settings.paused=true;return '第一頁已經可以閱讀';}
      return '可以先回答這一頁';
    }};
    engine=new Engine(f.store,provider,()=>{},()=>{});engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>f.book.pages[0].status==='done');
    assert.equal(f.book.extraction,'running');assert.equal(f.book.map?.complete,false);assert.equal(f.book.map?.pages.length,2);
    assert.equal(f.book.pages[0].contextComplete,false);assert.equal(f.book.pages[0].contextPages,2);
    await engine.ask(f.book.id,1,'這一頁可以先問嗎？');assert.equal(f.book.pages[0].messages[0].status,'done');
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
    assert.equal(calls,0);assert.equal(engine.activity,'講解已準備完成');
  } finally {engine?.stop();f.cleanup();}
});
test('repeated provider failures pause background work instead of failing every remaining page', async () => {
  const f=setup(20); let engine:Engine|undefined;
  try {
    withMap(f.book);let calls=0;
    engine=new Engine(f.store,{generate:async()=>{calls++;throw new Error('Provider rejected request');}},()=>{},()=>{});
    engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>f.store.settings.paused);
    assert.equal(calls,3);assert.equal(f.book.pages.filter(p=>p.status==='error').length,3);
    assert.equal(f.book.pages.filter(p=>p.status==='pending').length,17);
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
      f.store.settings.paused=true;
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
      if(schema?.properties?.links){f.store.settings.paused=true;return JSON.stringify({overview:'全書完成',terms:[],links:[1,2,3,4].map(page=>({page,relatedPages:[]}))});}
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
    f.store.updateSettings({paused:true});f.book.currentPage=6;
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
