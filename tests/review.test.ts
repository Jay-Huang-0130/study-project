import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../electron/store';
import {Reviews,validateReview,sourceKey,reviewFingerprint,namespaceReviewInputs,removeExactReviewDuplicates,reviewSchema,type ReviewGenerate} from '../electron/review';
import {reviewReady,reviewMergePlan,reviewProgress} from '../src/review-data';
import type {Book,ConceptGraph,ReviewSource} from '../src/shared';

function fixture(count=5){
  const dir=mkdtempSync(path.join(os.tmpdir(),'study-review-')),file=path.join(dir,'source.pdf');writeFileSync(file,'%PDF-1.4\nreview fixture');
  const store=new Store(path.join(dir,'library')),book=store.import(file);
  Object.assign(book,{count,extracted:count,extraction:'done',mapStatus:'done'});
  book.pages=Array.from({length:count},(_,i)=>({number:i+1,text:'ASK Amplitude Shift Keying. C = B log2(1 + SNR).',width:100,height:100,imageReady:true,status:'done',lesson:`完成第 ${i+1} 頁`,messages:[]}));
  book.map={version:'v1',complete:true,overview:'通訊',terms:[],pages:book.pages.map(p=>({page:p.number,topic:'調變',summary:'摘要',terms:[],relatedPages:[]}))};store.save(book);
  return {store,book,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
function graph(page=1):ConceptGraph{
  const sources:ReviewSource[]=[{page,kind:'text',quote:'ASK Amplitude Shift Keying.'}];
  const node=(id:string,kind:'topic'|'term'|'formula',label:string)=>({id,kind,label,fullName:'',summary:'原頁摘要',detail:'原頁說明',formula:'',symbols:[],conditions:[],sources});
  return {title:'通訊複習',rootId:'root',nodes:[node('root','topic','通訊'),node('topic','topic','調變'),{...node('ask','term','ASK'),fullName:'Amplitude Shift Keying'}, {...node('capacity','formula','Shannon Capacity'),formula:'C=B\\log_2(1+SNR)',symbols:[{symbol:'B',meaning:'頻寬',unit:'Hz'}],conditions:['依原頁條件使用']}],edges:[
    {id:'e1',source:'root',target:'topic',relation:'contains',label:'包含',detail:'',sources},
    {id:'e2',source:'topic',target:'ask',relation:'contains',label:'包含',detail:'',sources},
    {id:'e3',source:'root',target:'capacity',relation:'contains',label:'包含',detail:'',sources},
    {id:'e4',source:'ask',target:'capacity',relation:'compares',label:'測試關聯',detail:'測試用依據',sources}
  ]};
}
async function until(test:()=>boolean){const start=Date.now();while(!test()){if(Date.now()-start>4000)throw new Error('timed out');await new Promise(r=>setTimeout(r,5));}}
const pages=(images:string[])=>images.map(file=>Number(file.match(/p(\d+)\.jpg$/)![1]));

test('review gate requires complete extraction, map, lessons, images and pending answers',()=>{
  const f=fixture();try{
    assert.equal(reviewReady(f.book),true);
    for(const mutate of [(b:Book)=>b.extraction='running',(b:Book)=>b.map!.complete=false,(b:Book)=>b.map!.pages.pop(),(b:Book)=>b.map!.pages[0].page=2,(b:Book)=>b.pages[0].imageReady=false,(b:Book)=>b.pages[0].status='error',(b:Book)=>b.pages[0].messages.push({id:'qa',kind:'question',createdAt:'',question:'?',answer:'',status:'pending'})]){const b=structuredClone(f.book);mutate(b);assert.equal(reviewReady(b),false);}
    delete f.book.map!.complete;assert.equal(reviewReady(f.book),true);
  }finally{f.cleanup();}
});

test('review validation rejects fabricated text, bad sources, malformed hierarchies and dangling edges',()=>{
  const f=fixture();try{
    assert.deepEqual(validateReview(graph(),f.book,new Set([1])),graph());
    const mutations=[(g:ConceptGraph)=>g.nodes[1].sources=[{page:1,kind:'text',quote:'not present'}],(g:ConceptGraph)=>g.nodes[1].sources=[{page:2,kind:'visual',quote:'figure'}],(g:ConceptGraph)=>g.edges[0].target='missing',(g:ConceptGraph)=>g.edges[0].target='root',(g:ConceptGraph)=>g.edges.push({...g.edges[0],id:'duplicate'}),(g:ConceptGraph)=>g.edges.splice(1,1),(g:ConceptGraph)=>g.edges[0].source='topic'];
    for(const mutate of mutations){const g=graph();mutate(g);assert.throws(()=>validateReview(g,f.book,new Set([1])));}
    const g=graph();g.nodes[2].sources=[{page:1,kind:'visual',quote:'左上圖'}];assert.doesNotThrow(()=>validateReview(g,f.book,new Set([1])));
    const evidence=new Set(graph().nodes.flatMap(n=>n.sources.map(sourceKey)));
    assert.throws(()=>validateReview(g,f.book,new Set([1]),evidence),/未核對/);
    assert.doesNotThrow(()=>validateReview(graph(),f.book,new Set([1]),evidence));
  }finally{f.cleanup();}
});

test('manual generation reads every original page in batches and completed cache survives restart without model calls',async()=>{
  const f=fixture(21),calls:{prompt:string;images:string[]}[]=[];
  const generate:ReviewGenerate=async(_b,_s,prompt,images)=>{calls.push({prompt,images});return JSON.stringify(graph(images.length?pages(images)[0]:1));};
  let reviews=new Reviews(f.store,generate,()=>{});
  try{
    assert.equal(calls.length,0);assert.throws(()=>reviews.start(f.book.id,false),/登入/);reviews.start(f.book.id,true);
    await until(()=>f.book.review?.status==='done');await reviews.stop();
    assert.deepEqual(calls.flatMap(c=>pages(c.images)),Array.from({length:21},(_,i)=>i+1));
    assert.equal(calls.filter(c=>!c.images.length).length,3); // two intermediate groups + final
    assert.ok(calls[0].prompt.includes(f.book.pages[0].text));assert.equal(f.book.generationStarted,false);
    const count=calls.length,store=new Store(f.store.root);reviews=new Reviews(store,generate,()=>{});
    reviews.start(f.book.id,false);assert.equal(calls.length,count);assert.equal(store.book(f.book.id).review?.graph?.nodes.length,4);
  }finally{await reviews.stop();f.cleanup();}
});

test('failed run preserves checkpoints and manual continue skips already verified batches',async()=>{
  const f=fixture(),calls:number[][]=[];let fail=true;
  const reviews=new Reviews(f.store,async(_b,_s,_p,images)=>{calls.push(pages(images));if(images[0]?.endsWith('p5.jpg')&&fail)throw new Error('usage limit');return JSON.stringify(graph(images.length?pages(images)[0]:1));},()=>{});
  try{reviews.start(f.book.id,true);await until(()=>f.book.review?.status==='error');assert.equal(f.book.review!.completedChunks,1);assert.equal(calls.length,2);fail=false;await reviews.stop();reviews.start(f.book.id,true);await until(()=>f.book.review?.status==='done');assert.deepEqual(calls,[[1,2,3,4],[5],[5],[]]);
  }finally{await reviews.stop();f.cleanup();}
});

test('cancel ignores late provider output, restart pauses, manual regeneration failure retains previous map and view',async()=>{
  const f=fixture(1);let release:(s:string)=>void=()=>{};
  let reviews=new Reviews(f.store,()=>new Promise(resolve=>release=resolve),()=>{});
  try{
    reviews.start(f.book.id,true);reviews.cancel(f.book.id);release(JSON.stringify(graph()));await reviews.stop();assert.equal(f.book.review!.status,'paused');assert.equal(f.book.review!.chunks.length,0);
    f.book.review!.status='running';f.store.save(f.book);const restored=new Store(f.store.root);assert.equal(restored.book(f.book.id).review!.status,'paused');
    reviews=new Reviews(f.store,async()=>JSON.stringify(graph()),()=>{});reviews.start(f.book.id,true);await until(()=>f.book.review?.status==='done');await reviews.stop();
    const old=structuredClone(f.book.review!.graph);reviews.saveView(f.book.id,{positions:{ask:{x:20,y:30}},viewport:{x:10,y:20,zoom:.7},expanded:['root','topic'],selected:'ask'});
    assert.throws(()=>reviews.saveView(f.book.id,{positions:{},viewport:{x:0,y:0,zoom:0},expanded:[]}));
    const card={x:20,y:40,width:650,height:480,fontSize:18,open:true};reviews.saveView(f.book.id,{positions:{},viewport:{x:0,y:0,zoom:1},expanded:['root'],panel:card,toolsOpen:true});assert.deepEqual(f.book.review!.view!.panel,card);assert.throws(()=>reviews.saveView(f.book.id,{positions:{},viewport:{x:0,y:0,zoom:1},expanded:[],panel:{...card,width:99999}}));
    const windowCard={...card,maximized:true,normalBounds:{x:30,y:50,width:520,height:560}};
    reviews.saveView(f.book.id,{positions:{},viewport:{x:0,y:0,zoom:1},expanded:['root'],panel:windowCard});
    const disk=new Store(f.store.root);assert.deepEqual(disk.book(f.book.id).review!.view!.panel,windowCard);
    assert.throws(()=>reviews.saveView(f.book.id,{positions:{},viewport:{x:0,y:0,zoom:1},expanded:[],panel:{...windowCard,normalBounds:{...windowCard.normalBounds,width:Infinity}}}));
    assert.throws(()=>reviews.saveView(f.book.id,{positions:{},viewport:{x:0,y:0,zoom:1},expanded:[],panel:{...windowCard,maximized:'yes' as any}}));
    const view=structuredClone(f.book.review!.view);reviews=new Reviews(f.store,async()=>{throw new Error('offline');},()=>{});reviews.start(f.book.id,true,true);await until(()=>f.book.review?.status==='error');assert.deepEqual(f.book.review!.graph,old);assert.deepEqual(f.book.review!.view,view);
  }finally{await reviews.stop();f.cleanup();}
});

test('source changes mark cache stale and reject in-flight results; deleted/reimported book ignores old work',async()=>{
  const f=fixture(1);let release:(s:string)=>void=()=>{};
  const reviews=new Reviews(f.store,()=>new Promise(resolve=>release=resolve),()=>{});
  try{
    const version=reviewFingerprint(f.book);reviews.start(f.book.id,true);f.book.pages[0].lesson+=' changed';release(JSON.stringify(graph()));await until(()=>f.book.review?.status==='error');assert.notEqual(reviewFingerprint(f.book),version);assert.equal(f.book.review!.graph,undefined);await reviews.stop();
    reviews.start(f.book.id,true);const old=f.book;f.store.books.set(old.id,structuredClone(old));release(JSON.stringify(graph()));await reviews.stop();assert.equal(f.store.book(old.id).review!.graph,undefined);
  }finally{await reviews.stop();f.cleanup();}
});

test('26 original-page batches are 26/36 overall steps, not a completed map',()=>{
  const f=fixture(104);try{
    assert.deepEqual(reviewMergePlan(26),[7,2,1]);assert.deepEqual(reviewMergePlan(4),[1]);
    const r={status:'running' as const,stage:'合併',completedChunks:26,totalChunks:26,sourceVersion:'x',model:'mock',chunks:[]};
    assert.deepEqual(reviewProgress(r),{total:36,completed:26,merges:10,completedMerges:0});
    assert.equal(reviewProgress({...r,completedMerges:10}).completed,35);
    assert.equal(reviewProgress({...r,status:'done',completedMerges:10}).completed,36);
  }finally{f.cleanup();}
});

test('merge checkpoints survive restart and resume at the next group without repeating extraction or completed merges',async()=>{
  const f=fixture(104);let merges=0,extracts=0,failed=false;
  let reviews=new Reviews(f.store,async(_b,_s,_p,images,model,activity)=>{
    activity?.('running');activity?.('receiving');
    if(images.length){extracts++;return JSON.stringify(graph(pages(images)[0]));}
    merges++;if(merges===2){failed=true;throw new Error('quota');}return JSON.stringify(graph());
  },()=>{});
  try{
    reviews.start(f.book.id,true);await until(()=>f.book.review?.status==='error');await reviews.stop();
    assert.equal(failed,true);assert.equal(extracts,26);assert.equal(f.book.review!.completedMerges,1);assert.equal(f.book.review!.mergeLevels![0].length,1);assert.equal(f.book.review!.request,undefined);
    const store=new Store(f.store.root),book=store.book(f.book.id);
    reviews=new Reviews(store,async(_b,_s,_p,images)=>{assert.equal(images.length,0);merges++;return JSON.stringify(graph());},()=>{});
    assert.equal(merges,2);reviews.start(book.id,true);await until(()=>book.review?.status==='done');
    assert.equal(merges,11);assert.equal(book.review!.completedMerges,10);assert.deepEqual(book.review!.mergeLevels!.map(x=>x.length),[7,2,1]);assert.equal(reviewProgress(book.review!).completed,36);
  }finally{await reviews.stop();f.cleanup();}
});

test('late activity after cancellation cannot restore the running request status',async()=>{
  const f=fixture(1);let notify:((state:'running'|'receiving')=>void)|undefined;
  const reviews=new Reviews(f.store,async(_b,_s,_p,_images,_model,activity)=>{notify=activity;activity?.('running');return new Promise(()=>{});},()=>{});
  try{reviews.start(f.book.id,true);assert.equal(f.book.review!.request!.state,'running');reviews.cancel(f.book.id);notify?.('receiving');await reviews.stop();assert.equal(f.book.review!.status,'paused');assert.equal(f.book.review!.request,undefined);}
  finally{await reviews.stop();f.cleanup();}
});

test('merge input namespaces isolate local IDs and preserve all content and source references',()=>{
  const inputs=[graph(),graph(5)],namespaced=namespaceReviewInputs(inputs);
  assert.equal(new Set(namespaced.flatMap(g=>g.nodes.map(n=>n.id))).size,8);
  for(const g of namespaced){const ids=new Set(g.nodes.map(n=>n.id));assert.ok(ids.has(g.rootId));assert.ok(g.edges.every(e=>ids.has(e.source)&&ids.has(e.target)));}
  assert.deepEqual(namespaced[1].nodes[2].sources,inputs[1].nodes[2].sources);assert.equal(namespaced[1].nodes[2].label,'ASK');assert.equal(inputs[0].rootId,'root');
});

test('only exactly identical duplicate records can be collapsed, while conflicting IDs still fail',()=>{
  const f=fixture();try{
    const g=graph();g.nodes.push(structuredClone(g.nodes[2]));g.edges.push(structuredClone(g.edges[1]));
    assert.deepEqual(validateReview(removeExactReviewDuplicates(g),f.book,new Set([1])),graph());
    g.nodes[g.nodes.length-1].label='不同概念';assert.throws(()=>validateReview(removeExactReviewDuplicates(g),f.book,new Set([1])),/nodes\[4\].id 重複：ask/);
    const long=graph();long.nodes[2].summary='a'.repeat(241);assert.throws(()=>validateReview(long,f.book,new Set([1])),/nodes\[2\].summary.*240.*241/);
    const schema=reviewSchema as any;assert.equal(schema.properties.nodes.items.properties.summary.maxLength,240);assert.equal(schema.properties.nodes.items.properties.id.maxLength,64);assert.equal(schema.properties.nodes.items.properties.sources.maxItems,12);
  }finally{f.cleanup();}
});

function secondLayerFixture(){
  const f=fixture(107);
  f.book.review={status:'error',stage:'第 2 層合併重複概念與關係 · 第 1/2 組',completedChunks:27,totalChunks:27,sourceVersion:reviewFingerprint(f.book),model:f.store.settings.model,chunks:Array.from({length:27},(_,i)=>graph(i*4+1)),mergeLevels:[Array.from({length:7},()=>graph())],completedMerges:7};
  f.store.save(f.book);return f;
}

test('second-layer 34/37 failure is repaired once using precise feedback without rerunning the 34 completed steps',async()=>{
  const f=secondLayerFixture(),prompts:string[]=[];
  const reviews=new Reviews(f.store,async(_b,_s,prompt,images)=>{
    assert.equal(images.length,0);prompts.push(prompt);const result=graph();if(prompts.length===1)result.nodes[2].summary='a'.repeat(241);
    return JSON.stringify(result);
  },()=>{});
  try{
    assert.equal(reviewProgress(f.book.review!).completed,34);reviews.start(f.book.id,true);await until(()=>f.book.review?.status==='done');
    assert.equal(prompts.length,4);assert.ok(prompts[1].includes('nodes[2].summary'));assert.ok(prompts[1].includes('【驗證回饋】'));assert.equal(f.book.review!.completedMerges,10);assert.equal(reviewProgress(f.book.review!).completed,37);assert.equal(f.book.review!.validationFailure,undefined);
  }finally{await reviews.stop();f.cleanup();}
});

test('conflicting duplicate ID repair is bounded, retains diagnostic output and checkpoints, and manual continue reuses feedback',async()=>{
  const f=secondLayerFixture();let calls=0,repaired=false;const prompts:string[]=[];
  const reviews=new Reviews(f.store,async(_b,_s,prompt)=>{
    calls++;prompts.push(prompt);const g=graph();if(!repaired)g.nodes.push({...g.nodes[2],label:'different'});return JSON.stringify(g);
  },()=>{});
  try{
    reviews.start(f.book.id,true);await until(()=>f.book.review?.status==='error');await reviews.stop();
    assert.equal(calls,2);assert.equal(reviewProgress(f.book.review!).completed,34);assert.equal(f.book.review!.mergeLevels![0].length,7);assert.equal(f.book.review!.validationFailure!.attempts,2);assert.ok(f.book.review!.validationFailure!.output?.includes('different'));assert.match(f.book.review!.error!,/id 重複/);
    repaired=true;reviews.start(f.book.id,true);await until(()=>f.book.review?.status==='done');assert.equal(calls,5);assert.ok(prompts[2].includes('【驗證回饋】'));assert.equal(f.book.review!.completedMerges,10);
  }finally{await reviews.stop();f.cleanup();}
});
