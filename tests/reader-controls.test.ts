import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Markdown} from '../src/Markdown';
import {normalizeMath} from '../src/math-format';
import {PDFWheelPager} from '../src/pdf-wheel';
const render=(text:string)=>renderToStaticMarkup(createElement(Markdown,{text,navigate:()=>{}}));

test('math renders mixed prose, list formulas and multiline delimiters without losing equation suffixes',()=>{
  const text=String.raw`1. 代入：$$265000=2\times20000\log_2 L
\quad\Rightarrow\quad L=2^{6.625}\approx98.7$$

2. 使用 $128=2^7$ 階。`;
  const html=render(text);assert.ok(html.includes('katex-display'));assert.ok(html.includes('98.7'));assert.ok(!html.includes('math-fallback'));assert.ok(!html.includes('katex-error'));assert.ok(!html.includes('98.7$$'));assert.equal((html.match(/<li>/g)||[]).length,2);
  assert.ok(render(String.raw`\quad\Rightarrow\quad L=2^{6.625}\approx98.7$$`).includes('katex-display'));
});
test('LaTeX delimiters work while code, escaped dollars and incomplete streams retain their original text',()=>{
  const html=render(String.raw`公式 \(R=2B\log_2 L\)，以及 \[C=B\log_2(1+SNR)\]。`);
  assert.ok(html.includes('katex-display'));assert.ok(!html.includes('math-fallback'));
  for(const code of ['`$$x=2$$`','```latex\n$$x=2$$\n\\[a=b\\]\n```','~~~tex\n$$x=2$$\n~~~','```latex\n$$unfinished'])assert.equal(normalizeMath(code),code);
  assert.equal(normalizeMath(String.raw`\$5 與 \$6`),String.raw`\$5 與 \$6`);
  assert.equal(normalizeMath('尚未完成 $$x='),'尚未完成 $$x=');
  const broken=render(String.raw`$\frac{1}{$`);assert.ok(broken.includes('math-fallback'));assert.ok(broken.includes('frac'));assert.ok(broken.includes('公式原式'));
});
test('wheel turns one page per deliberate gesture and respects document boundaries',()=>{
  const pager=new PDFWheelPager(),base={top:0,height:600,viewport:600,page:2,count:3};
  assert.equal(pager.handle({...base,now:1000,delta:30}),'hold');assert.equal(pager.handle({...base,now:1010,delta:50}),'next');
  for(const now of [1100,1300,1420])assert.equal(pager.handle({...base,page:3,now,delta:100}),'hold');
  assert.equal(pager.handle({...base,now:1700,delta:-100}),'previous');
  assert.equal(pager.handle({...base,page:1,now:2500,delta:-100}),'hold');
  assert.equal(pager.handle({...base,page:3,now:3000,delta:100}),'hold');
});
test('display delimiters inside tables retain table cells and inline math',()=>{
  const html=render('| 公式 | 意義 |\n| --- | --- |\n| $$C=B\\log_2(1+SNR)$$ | 容量 |');
  assert.ok(html.includes('<table>'));assert.equal((html.match(/<td>/g)||[]).length,2);assert.ok(html.includes('class="katex"'));assert.ok(!html.includes('math-fallback'));
});
test('long pages scroll first; momentum at the edge cannot skip unread content',()=>{
  const pager=new PDFWheelPager(),base={height:1200,viewport:600,page:2,count:5};
  assert.equal(pager.handle({...base,top:200,now:1000,delta:100}),'scroll');
  assert.equal(pager.handle({...base,top:600,now:1050,delta:100}),'hold');
  assert.equal(pager.handle({...base,top:600,now:1400,delta:100}),'next');
  assert.equal(pager.handle({...base,top:600,now:2000,delta:-100}),'scroll');
  assert.equal(pager.handle({...base,top:0,now:2050,delta:-100}),'hold');
  assert.equal(pager.handle({...base,top:0,now:2400,delta:-100}),'previous');
});
