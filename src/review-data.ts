import type {Book,ReviewRecord} from './shared';
export function reviewMergePlan(chunks:number){const levels:number[]=[];let groups=Math.max(1,chunks);while(groups>4){groups=Math.ceil(groups/4);levels.push(groups);}return [...levels,1];}
export function reviewProgress(review:ReviewRecord){
  const merges=reviewMergePlan(review.totalChunks).reduce((a,b)=>a+b,0),total=review.totalChunks+merges;
  const completed=review.completedChunks+(review.completedMerges??0);
  return {total,completed:review.status==='done'?total:Math.min(completed,Math.max(0,total-1)),merges,completedMerges:review.completedMerges??0};
}
export function reviewReady(book:Book){
  return book.count>0&&book.extraction==='done'&&book.pages.length===book.count&&book.mapStatus==='done'&&!!book.map&&book.map.complete!==false&&book.map.pages.length===book.count&&new Set(book.map.pages.map(p=>p.page)).size===book.count&&book.map.pages.every(p=>Number.isInteger(p.page)&&p.page>=1&&p.page<=book.count)&&
    book.pages.every(p=>p.imageReady&&p.status==='done'&&p.messages.every(m=>m.status==='done'));
}
