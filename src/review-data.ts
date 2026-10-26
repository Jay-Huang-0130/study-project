import type {Book} from './shared';
export function reviewReady(book:Book){
  return book.count>0&&book.extraction==='done'&&book.pages.length===book.count&&book.mapStatus==='done'&&!!book.map&&book.map.complete!==false&&book.map.pages.length===book.count&&new Set(book.map.pages.map(p=>p.page)).size===book.count&&book.map.pages.every(p=>Number.isInteger(p.page)&&p.page>=1&&p.page<=book.count)&&
    book.pages.every(p=>p.imageReady&&p.status==='done'&&p.messages.every(m=>m.status==='done'));
}
