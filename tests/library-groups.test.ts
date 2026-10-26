import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../electron/store';
import {clampPanel} from '../src/panel-layout';

function setup(count=21){const dir=mkdtempSync(path.join(os.tmpdir(),'study-groups-')),store=new Store(path.join(dir,'library'));for(let i=0;i<count;i++){const file=path.join(dir,`lesson-${i}.pdf`);writeFileSync(file,`%PDF-1.4\nfixture ${i}`);store.import(file);}return {dir,store,ids:[...store.books.keys()],cleanup:()=>rmSync(dir,{recursive:true,force:true})};}
test('21 textbooks move together, survive rename and restart, and group removal preserves every book and source',()=>{
 const f=setup();try{
  const originals=f.ids.map(id=>readFileSync(path.join(f.store.dir(id),'book.json'),'utf8'));
  const group=f.store.createGroup('線性代數'),other=f.store.createGroup('網路通訊');f.store.moveBooks(f.ids,group);f.store.renameGroup(group,'線性代數（一）');
  assert.ok(f.store.summaries().every(b=>b.groupId===group));assert.deepEqual(f.ids.map(id=>readFileSync(path.join(f.store.dir(id),'book.json'),'utf8')),originals);
  const restored=new Store(f.store.root);assert.equal(restored.library.groups.find(g=>g.id===group)?.name,'線性代數（一）');assert.ok(restored.summaries().every(b=>b.groupId===group));restored.moveBooks([f.ids[0]],other);restored.deleteGroup(group);
  assert.equal(restored.books.size,21);assert.equal(restored.summaries().find(b=>b.id===f.ids[0])?.groupId,other);assert.ok(restored.summaries().filter(b=>b.id!==f.ids[0]).every(b=>!b.groupId));for(const id of f.ids)assert.ok(readFileSync(path.join(restored.dir(id),'source.pdf'),'utf8').startsWith('%PDF-'));
 }finally{f.cleanup();}
});
test('invalid group operations do not partially move textbooks; deleting one book removes only its membership',()=>{
 const f=setup(2);try{
  const g=f.store.createGroup('A');assert.throws(()=>f.store.createGroup(' Ａ '),/同名/);for(const name of ['', ' '.repeat(4),'x'.repeat(61)])assert.throws(()=>f.store.createGroup(name));
  assert.throws(()=>f.store.moveBooks([f.ids[0],'unknown'],g));assert.equal(f.store.summaries()[0].groupId,undefined);assert.throws(()=>f.store.moveBooks(f.ids,'missing'));
  f.store.moveBooks(f.ids,g);f.store.deleteBook(f.ids[0]);assert.equal(f.store.library.memberships[f.ids[0]],undefined);assert.equal(f.store.library.memberships[f.ids[1]],g);assert.equal(f.store.library.groups.length,1);
 }finally{f.cleanup();}
});
test('failed metadata write leaves visible group state unchanged',()=>{
 const f=setup(1);try{mkdirSync(path.join(f.store.root,'library.json'));assert.throws(()=>f.store.createGroup('資料庫'));assert.equal(f.store.library.groups.length,0);assert.deepEqual(f.store.library.memberships,{});}finally{f.cleanup();}
});
test('floating info card restores inside a smaller canvas and bounds size and text zoom',()=>{
 const panel=clampPanel({x:1500,y:900,width:1200,height:1000,fontSize:40,open:true},{width:900,height:650});
 assert.deepEqual(panel,{x:12,y:12,width:876,height:626,fontSize:26,open:true});
 const collapsed=clampPanel({...panel,y:1000,open:false},{width:900,height:650});assert.equal(collapsed.y,590);
 const minimum=clampPanel({x:-100,y:-100,width:100,height:50,fontSize:5,open:true},{width:900,height:650});assert.equal(minimum.x,12);assert.equal(minimum.y,12);assert.equal(minimum.width,280);assert.equal(minimum.height,160);assert.equal(minimum.fontSize,12);
});
