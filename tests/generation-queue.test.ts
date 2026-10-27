import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {Store} from '../electron/store';import {Engine,type Provider} from '../electron/engine';
import {bookComplete} from '../electron/book-state';
import type {Book} from '../src/shared';
function fixture(count=3,pages=6){
 const root=mkdtempSync(path.join(os.tmpdir(),'study-fifo-')),store=new Store(path.join(root,'library'));
 const books=Array.from({length:count},(_,i)=>{const file=path.join(root,`${i}.pdf`);writeFileSync(file,`%PDF-1.4 fixture ${i}`);const b=store.import(file);b.count=pages;b.extraction='done';b.extracted=pages;b.generationPaused=true;
 b.pages=Array.from({length:pages},(_,i)=>({number:i+1,text:'原頁',width:100,height:100,imageReady:true,lesson:'',status:'pending' as const,messages:[]}));
 b.map={version:'v',complete:true,overview:'全書',terms:[],pages:b.pages.map(p=>({page:p.number,topic:'主題',summary:'摘要',terms:[],relatedPages:[]}))};b.mapChunks=[b.map.pages];b.mapStatus='done';store.save(b);return b;});
 return {store,books,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
const numbers=(prompt:string)=>prompt.match(/唯一目標頁碼（依序）：([\d、]+)/)![1].split('、').map(Number);
const reply=(prompt:string)=>numbers(prompt).map(page=>JSON.stringify({page,lesson:'完成講稿'})).join('\n');
async function until(fn:()=>boolean){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw Error('queue timed out');await new Promise(r=>setTimeout(r,5));}}
function controlled(){const calls:{prompt:string;finish:(text:string)=>void;delta?:((text:string)=>void)}[]=[];const provider:Provider={generate:async(prompt,_images,_model,_instructions,delta)=>new Promise<string>(finish=>calls.push({prompt,finish,delta}))};return {calls,provider};}
test('ten PDFs finish in click order, never rotate between batches; default has no five-second gap',async()=>{
 const f=fixture(10),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{const order=[...f.books].reverse();for(const b of order)engine.resumeBook(b.id);assert.deepEqual(engine.queue.map(e=>e.id),order.map(b=>b.id));
 for(let i=0;i<order.length;i++)for(let batch=0;batch<2;batch++){const index=i*2+batch;await until(()=>c.calls.length>index);const call=c.calls[index];assert.ok(call.prompt.includes(`教材：${order[i].name}`));assert.deepEqual(numbers(call.prompt),batch===0?[1,2,3,4,5]:[6]);
 const ended=Date.now();call.finish(reply(call.prompt));await until(()=>engine.progress.activeLessons===0);if(index<19){await until(()=>c.calls.length>index+1);assert.ok(Date.now()-ended<1500,'ready next batch must not wait five seconds');}}
 await until(()=>engine.queue.length===0);assert.ok(order.every(bookComplete));
 }finally{engine.stop();f.cleanup();}
});
test('a final streamed page cannot release FIFO until its model request ends',async()=>{
 const f=fixture(2,1),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{f.books.forEach(b=>engine.resumeBook(b.id));const first=c.calls[0],text=reply(first.prompt);first.delta?.(text);assert.equal(f.books[0].pages[0].status,'done');assert.equal(engine.bookState(f.books[0]),'running');engine.wake();assert.equal(c.calls.length,1);assert.equal(engine.queue[0].id,f.books[0].id);first.finish(text);await until(()=>c.calls.length===2);c.calls[1].finish(reply(c.calls[1].prompt));await until(()=>engine.queue.length===0);}finally{engine.stop();f.cleanup();}
});
test('head waits for local prerequisites and for complete overview, not just all lessons',async()=>{
 const f=fixture(2,1),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{f.books[0].pages[0].imageReady=false;f.books.forEach(b=>engine.resumeBook(b.id));assert.equal(c.calls.length,0);assert.equal(engine.bookState(f.books[1]),'queued');f.books[0].pages[0].imageReady=true;f.books[0].pages[0].status='done';f.books[0].map!.complete=false;f.books[0].mapStatus='pending';engine.wake();assert.equal(c.calls.length,1);assert.match(c.calls[0].prompt,/根據完整逐頁索引/);engine.wake();assert.equal(c.calls.length,1);
 c.calls[0].finish(JSON.stringify({overview:'完整',terms:[],links:[{page:1,relatedPages:[]}]}));await until(()=>c.calls.length===2);assert.ok(c.calls[1].prompt.includes(`教材：${f.books[1].name}`));c.calls[1].finish(reply(c.calls[1].prompt));await until(()=>engine.queue.length===0);}finally{engine.stop();f.cleanup();}
});
test('pause skips head, resume appends once at tail, reordering preserves active book',async()=>{
 const f=fixture(3,1),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{f.books.forEach(b=>engine.resumeBook(b.id));engine.pauseBook(f.books[0].id);await until(()=>c.calls.length===2);engine.resumeBook(f.books[0].id);engine.resumeBook(f.books[0].id);assert.deepEqual(engine.queue.map(e=>e.id),[f.books[1].id,f.books[2].id,f.books[0].id]);
 engine.reorderQueue([f.books[1].id,f.books[0].id,f.books[2].id]);assert.throws(()=>engine.reorderQueue([f.books[0].id,f.books[1].id,f.books[2].id]),/正在處理/);assert.throws(()=>engine.reorderQueue([f.books[1].id,f.books[1].id,f.books[2].id]),/佇列已變更/);
 c.calls[0].finish(reply(c.calls[0].prompt));c.calls[1].finish(reply(c.calls[1].prompt));await until(()=>c.calls.length===3);assert.ok(c.calls[2].prompt.includes(`教材：${f.books[0].name}`));c.calls[2].finish(reply(c.calls[2].prompt));await until(()=>c.calls.length===4);assert.ok(c.calls[3].prompt.includes(`教材：${f.books[2].name}`));c.calls[3].finish(reply(c.calls[3].prompt));await until(()=>engine.queue.length===0);
 }finally{engine.stop();f.cleanup();}
});
test('failure skips book without replaying it; manual resume joins tail',async()=>{
 const f=fixture(3,1);let fail=true;const starts:string[]=[];const engine=new Engine(f.store,{generate:async prompt=>{starts.push(prompt);if(fail){fail=false;throw Error('fixture failure');}return reply(prompt);}},()=>{},()=>{});engine.authenticated=true;
 try{f.books.forEach(b=>engine.resumeBook(b.id));await until(()=>f.books[1].pages[0].status==='done');assert.equal(f.books[0].generationPaused,true);engine.resumeBook(f.books[0].id);await until(()=>engine.queue.length===0);assert.ok(f.books.every(bookComplete));assert.ok(starts[2].includes(`教材：${f.books[2].name}`));assert.ok(starts[3].includes(`教材：${f.books[0].name}`));}finally{engine.stop();f.cleanup();}
});
test('reservation preserves click order while earlier auth/PDF cleanup is pending; pause cancels reservation',async()=>{
 const f=fixture(3,1),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{engine.prepareBook(f.books[0].id);engine.resumeBook(f.books[1].id);assert.equal(c.calls.length,0);assert.equal(engine.queue[0].id,f.books[0].id);engine.pauseBook(f.books[0].id);await until(()=>c.calls.length===1);assert.ok(c.calls[0].prompt.includes(`教材：${f.books[1].name}`));c.calls[0].finish(reply(c.calls[0].prompt));await until(()=>engine.queue.length===0);}finally{engine.stop();f.cleanup();}
});
test('queued questions cannot bypass earlier PDF; completed book cache and restart never auto-start',async()=>{
 const f=fixture(2,1),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{engine.resumeBook(f.books[0].id);engine.resumeBook(f.books[1].id);await engine.ask(f.books[1].id,1,'為什麼');assert.equal(c.calls.length,1);assert.equal(f.books[1].pages[0].messages[0].status,'pending');c.calls[0].finish(reply(c.calls[0].prompt));await until(()=>c.calls.length===2);assert.match(c.calls[1].prompt,/為什麼/);c.calls[1].finish('回答');await until(()=>c.calls.length===3);c.calls[2].finish(reply(c.calls[2].prompt));await until(()=>engine.queue.length===0);engine.resumeBook(f.books[0].id);assert.equal(c.calls.length,3);
 const restored=new Store(f.store.root),again=new Engine(restored,c.provider,()=>{},()=>{});again.authenticated=true;again.wake();assert.equal(again.queue.length,0);assert.equal(c.calls.length,3);again.stop();}finally{engine.stop();f.cleanup();}
});
test('deleted active identity and stale reorder cannot affect a reimport',async()=>{
 const f=fixture(2,1),c=controlled(),engine=new Engine(f.store,c.provider,()=>{},()=>{});engine.authenticated=true;
 try{f.books.forEach(b=>engine.resumeBook(b.id));engine.pauseBook(f.books[0].id);f.store.deleteBook(f.books[0].id);assert.throws(()=>engine.reorderQueue([f.books[0].id,f.books[1].id]),/佇列已變更/);await until(()=>c.calls.length===2);c.calls[0].finish(reply(c.calls[0].prompt));c.calls[1].finish(reply(c.calls[1].prompt));await until(()=>engine.queue.length===0);assert.equal(f.store.books.has(f.books[0].id),false);}finally{engine.stop();f.cleanup();}
});
