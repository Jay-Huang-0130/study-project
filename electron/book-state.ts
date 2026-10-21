import type {Book} from '../src/shared';

export function bookComplete(book:Book){
  return book.mapStatus==='done'&&!!book.map&&book.map.complete!==false&&book.map.pages.length===book.count&&book.count>0&&book.pages.length===book.count&&
    book.pages.every(p=>p.status==='done'&&p.messages.every(m=>m.status==='done'));
}
