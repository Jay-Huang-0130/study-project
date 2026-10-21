import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store';
import { Engine, nextPage, validateMapChunk, acceptsResult, type Provider } from '../electron/engine';
import type { Book } from '../src/shared';

function setup(count = 3) {
  const dir = mkdtempSync(path.join(os.tmpdir(),'study-test-'));
  const file = path.join(dir,'lecture.pdf'); writeFileSync(file,'%PDF-1.4\nfixture');
  const store = new Store(path.join(dir,'library')); const book = store.import(file);
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
test('map chunks are persisted and no lessons start until whole-book overview exists', async () => {
  const f=setup(7); let engine:Engine|undefined;
  try {
    const imageCounts:number[]=[]; let calls=0;
    const provider:Provider={generate:async(_prompt,images)=>{
      calls++; imageCounts.push(images.length);
      if(calls<=2){const numbers=calls===1?[1,2,3,4,5,6]:[7];return JSON.stringify({pages:numbers.map(page=>({page,topic:'概念',summary:'說明',terms:[],relatedPages:[]}))});}
      if(calls===3){f.store.settings.paused=true;return JSON.stringify({overview:'全書順序',terms:[],links:Array.from({length:7},(_,i)=>({page:i+1,relatedPages:i===6?[1]:[]}))});}
      throw new Error('Should not generate a lesson before requested');
    }};
    engine=new Engine(f.store,provider,()=>{},()=>{});engine.activeId=f.book.id;engine.authenticated=true;engine.wake();
    await until(()=>f.book.mapStatus==='done'); assert.deepEqual(imageCounts,[6,1,0]);
    assert.equal(f.book.pages.filter(p=>p.status==='done').length,0);
    assert.equal(new Store(f.store.root).book(f.book.id).map?.pages.length,7);
    assert.deepEqual(f.book.map!.pages[6].relatedPages,[1]);
  } finally {engine?.stop();f.cleanup();}
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
