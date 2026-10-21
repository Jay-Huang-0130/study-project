import type { Book, OutlineEntry, PageMap } from './shared';

export interface ReadingNode { key:string; title:string; start:number; end:number; summary:string; children:ReadingNode[] }
export function shortSummary(text:string,max=64){
  const plain=text.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_#`>]/g,'').replace(/\s+/g,' ').trim();
  const first=plain.match(/^.*?[。！？](?=\s|[^\x00-\x7f]|$)/u)?.[0]||plain;
  return [...first].length>max?[...first].slice(0,max).join('')+'…':first;
}
// Presentation only: every physical page occurs once. No new model request or invented chapter names.
export function readingOutline(book:Book,outline:OutlineEntry[]):ReadingNode[]{
  const indexed=new Map<number,PageMap>((book.map?.pages??[]).map(p=>[p.page,p]));
  const leaf=(n:number):ReadingNode=>({key:`page-${n}`,title:indexed.get(n)?.topic||`第 ${n} 頁`,start:n,end:n,summary:shortSummary(indexed.get(n)?.summary||'尚未分析；可先閱讀原文。'),children:[]});
  const build=(entries:OutlineEntry[],start:number,end:number,prefix:string):ReadingNode[]=>{
    const valid=entries.filter(e=>Number.isInteger(e.page)&&e.page>=start&&e.page<=end).sort((a,b)=>a.page-b.page)
      .filter((e,i,a)=>i===0||a[i-1].page!==e.page);
    const nodes:ReadingNode[]=[];
    const addPages=(a:number,b:number)=>{for(let n=a;n<=b;n++)nodes.push(leaf(n));};
    let cursor=start;
    valid.forEach((entry,i)=>{
      addPages(cursor,entry.page-1);
      const last=(valid[i+1]?.page??end+1)-1;
      const children=build(entry.children,entry.page,last,`${prefix}-${i}`);
      nodes.push({key:`section-${prefix}-${i}`,title:entry.title||`第 ${entry.page} 頁`,start:entry.page,end:last,
        summary:shortSummary(indexed.get(entry.page)?.summary||''),children});
      cursor=last+1;
    });
    addPages(cursor,end);return nodes;
  };
  if(outline.some(e=>e.page>=1&&e.page<=book.count))return build(outline,1,book.count,'root');
  // Slides often have no embedded table of contents. Label ranges honestly instead of guessing chapters.
  const roots:ReadingNode[]=[];
  for(let start=1;start<=book.count;start+=8){
    const end=Math.min(book.count,start+7),children=Array.from({length:end-start+1},(_,i)=>leaf(start+i));
    const topics=[...new Set(children.filter(c=>indexed.has(c.start)).map(c=>c.title))];
    roots.push({key:`group-${start}`,title:topics.slice(0,2).join(' ／ ')||'等待整理主題',start,end,
      summary:`第 ${start}–${end} 頁`,children});
  }
  return roots;
}
