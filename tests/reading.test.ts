import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readingOutline,shortSummary,type ReadingNode} from '../src/reading-outline';
import {normalizeSettings,Store} from '../electron/store';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Book} from '../src/shared';
const book={count:19,map:{pages:[{page:1,topic:'導論',summary:'先了解基本概念。接著看例子。'}]}} as Book;
const pages=(nodes:ReadingNode[]):number[]=>nodes.flatMap(n=>n.children.length?pages(n.children):[n.start]);
test('outline preserves each physical page once with nested, duplicate and invalid destinations',()=>{
  const tree=readingOutline(book,[{title:'第一章',page:3,children:[{title:'小節',page:5,children:[]}]},{title:'第二章',page:10,children:[]},{title:'重複',page:10,children:[]},{title:'錯誤',page:99,children:[]}]);
  assert.deepEqual(pages(tree),Array.from({length:19},(_,i)=>i+1));
  assert.equal(tree.find(n=>n.title==='第一章')?.end,9);
  assert.equal(tree.find(n=>n.title==='第一章')?.children.find(n=>n.title==='小節')?.start,5);
});
test('legacy PDFs without bookmarks display bounded groups and short summaries before analysis completes',()=>{
  const tree=readingOutline(book,[]);assert.equal(tree.length,3);
  assert.deepEqual(pages(tree),Array.from({length:19},(_,i)=>i+1));
  assert.equal(tree[0].children[0].summary,'先了解基本概念。');
  assert.equal(readingOutline({...book,map:undefined},[])[0].children[0].summary,'尚未分析；可先閱讀原文。');
  assert.equal([...shortSummary('繁'.repeat(90))].length,65);
  assert.equal(shortSummary('[主題](study://page/1) **重點**'),'主題 重點');
});
test('typography settings migrate, validate independently and survive reopening',()=>{
  const defaults=normalizeSettings({});assert.equal(defaults.uiScale,100);assert.equal(defaults.readingFontSize,13);
  const invalid=normalizeSettings({uiScale:1000,readingFontSize:NaN});assert.equal(invalid.uiScale,100);assert.equal(invalid.readingFontSize,13);
  const dir=mkdtempSync(path.join(os.tmpdir(),'study-font-'));
  try{const store=new Store(dir);store.updateSettings({uiScale:120,readingFontSize:20});const restored=new Store(dir);assert.equal(restored.settings.uiScale,120);assert.equal(restored.settings.readingFontSize,20);assert.equal(restored.settings.aiConcurrency,1);}finally{rmSync(dir,{recursive:true,force:true});}
});
