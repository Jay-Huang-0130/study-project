import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Book, BookSummary, StudySettings } from '../src/shared';

export function normalizeSettings(raw:Partial<StudySettings>):StudySettings{
  return {paused:typeof raw.paused==='boolean'?raw.paused:false,model:typeof raw.model==='string'?raw.model:'',
    aiConcurrency:Number.isInteger(raw.aiConcurrency)&&raw.aiConcurrency!>=1&&raw.aiConcurrency!<=6?raw.aiConcurrency!:4,
    pdfWorkers:Number.isInteger(raw.pdfWorkers)&&raw.pdfWorkers!>=1&&raw.pdfWorkers!<=4?raw.pdfWorkers!:2,
    lessonDetail:raw.lessonDetail&&['concise','standard','detailed'].includes(raw.lessonDetail)?raw.lessonDetail:'concise'};
}

export function atomicJSON(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { encoding: 'utf8', flush: true });
  renameSync(tmp, file);
}
export class Store {
  books = new Map<string, Book>();
  settings:StudySettings=normalizeSettings({});
  constructor(public root: string) {
    mkdirSync(path.join(root, 'books'), { recursive: true });
    const settingsFile = path.join(root, 'settings.json');
    if (existsSync(settingsFile)) this.settings = normalizeSettings(JSON.parse(readFileSync(settingsFile, 'utf8')));
    for (const id of readdirSync(path.join(root, 'books'))) {
      const file = path.join(root, 'books', id, 'book.json');
      if (!existsSync(file)) continue;
      // Fail visibly on corruption instead of silently replacing learning records.
      const book: Book = JSON.parse(readFileSync(file, 'utf8'));
      if (book.id !== id || !Array.isArray(book.pages)) throw new Error(`教材資料格式錯誤：${id}`);
      if (book.mapStatus === 'running') book.mapStatus = 'pending';
      if (book.extraction === 'running') book.extraction = 'pending';
      for (const page of book.pages) {
        if (page.status === 'running') page.status = 'pending';
        for (const m of page.messages) if (m.status === 'running' || m.status === 'pending') {
          m.status = 'error'; m.error = '上次問答中斷，請重新送出問題。';
        }
      }
      this.books.set(id, book);
      this.save(book);
    }
  }
  book(id: string) { const b = this.books.get(id); if (!b) throw new Error('找不到教材'); return b; }
  dir(id: string) { this.book(id); return path.join(this.root, 'books', id); }
  save(book: Book) {
    // Ignore late work for deleted books, including when identical bytes were reimported.
    if(this.books.get(book.id)!==book)return;
    atomicJSON(path.join(this.root, 'books', book.id, 'book.json'), book);
  }
  deleteBook(id:string){
    this.book(id);
    const target=path.resolve(this.dir(id)),booksRoot=path.resolve(this.root,'books');
    if(!/^[a-f0-9]{64}$/.test(id)||path.dirname(target)!==booksRoot)throw new Error('教材資料位置無效');
    rmSync(target,{recursive:true,force:true});
    this.books.delete(id);
  }
  deleteMessage(id:string,n:number,messageId:string){
    const book=this.book(id);
    if(!Number.isInteger(n)||n<1||n>book.count)throw new Error('頁碼不在教材範圍內');
    if(typeof messageId!=='string'||!messageId)throw new Error('問答紀錄無效');
    const page=book.pages[n-1],message=page.messages.find(m=>m.id===messageId);
    if(!message)throw new Error('找不到這筆問答紀錄');
    if(message.status==='running'||message.status==='pending')throw new Error('請等待回答完成後再刪除');
    const messages=page.messages.filter(m=>m.id!==messageId);
    // Persist first so a failed disk write leaves the visible history intact.
    atomicJSON(path.join(this.dir(id),'book.json'),{...book,pages:book.pages.map(p=>p===page?{...p,messages}:p)});
    page.messages=messages;
  }
  updateSettings(value: Partial<typeof this.settings>) { Object.assign(this.settings, value); atomicJSON(path.join(this.root, 'settings.json'), this.settings); }
  import(file: string): Book {
    const bytes = readFileSync(file);
    if (!bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new Error('這不是有效的 PDF 檔案');
    const id = createHash('sha256').update(bytes).digest('hex');
    if (this.books.has(id)) return this.book(id);
    const book: Book = { id, name: path.basename(file), count: 0, currentPage: 1, createdAt: new Date().toISOString(), extraction: 'pending', extracted: 0, mapStatus: 'pending', mapChunks: [], pages: [] };
    mkdirSync(path.join(this.root, 'books', id), { recursive: true });
    copyFileSync(file, path.join(this.root, 'books', id, 'source.pdf'));
    this.books.set(id, book); this.save(book); return book;
  }
  summaries(): BookSummary[] {
    return [...this.books.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(b => ({ id: b.id, name: b.name, count: b.count, currentPage: b.currentPage, createdAt: b.createdAt, completed: b.pages.filter(p => p.status === 'done').length }));
  }
}
