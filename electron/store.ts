import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {bookComplete} from './book-state';
import type { Book, BookSummary, StudySettings, LibraryGroup } from '../src/shared';

export function normalizeSettings(raw:Partial<StudySettings>):StudySettings{
  return {paused:typeof raw.paused==='boolean'?raw.paused:false,model:typeof raw.model==='string'?raw.model:'',
    // Migrate older parallel settings to one global model request.
    aiConcurrency:1,
    pdfWorkers:Number.isInteger(raw.pdfWorkers)&&raw.pdfWorkers!>=1&&raw.pdfWorkers!<=4?raw.pdfWorkers!:2,
    lessonDetail:raw.lessonDetail&&['concise','standard','detailed'].includes(raw.lessonDetail)?raw.lessonDetail:'concise',
    uiScale:Number.isInteger(raw.uiScale)&&raw.uiScale!>=80&&raw.uiScale!<=150?raw.uiScale!:100,
    readingFontSize:Number.isInteger(raw.readingFontSize)&&raw.readingFontSize!>=12&&raw.readingFontSize!<=26?raw.readingFontSize!:13};
}

export function atomicJSON(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { encoding: 'utf8', flush: true });
  renameSync(tmp, file);
}
export class Store {
  books = new Map<string, Book>();
  library:{groups:LibraryGroup[];memberships:Record<string,string>}={groups:[],memberships:{}};
  settings:StudySettings=normalizeSettings({});
  constructor(public root: string) {
    mkdirSync(path.join(root, 'books'), { recursive: true });
    const libraryFile=path.join(root,'library.json');
    if(existsSync(libraryFile)){
      const value=JSON.parse(readFileSync(libraryFile,'utf8'));
      if(!value||!Array.isArray(value.groups)||value.groups.length>200||!value.memberships||typeof value.memberships!=='object'||Array.isArray(value.memberships))throw new Error('教材群組資料格式錯誤');
      const ids=new Set<string>();
      for(const group of value.groups){if(!group||typeof group.id!=='string'||!group.id||ids.has(group.id)||typeof group.name!=='string'||!group.name.trim()||[...group.name].length>60)throw new Error('教材群組資料格式錯誤');ids.add(group.id);}
      for(const [id,group] of Object.entries(value.memberships))if(!/^[a-f0-9]{64}$/.test(id)||typeof group!=='string'||!ids.has(group))throw new Error('教材群組歸屬格式錯誤');
      this.library=value;
    }
    const settingsFile = path.join(root, 'settings.json');
    if (existsSync(settingsFile)) this.settings = normalizeSettings(JSON.parse(readFileSync(settingsFile, 'utf8')));
    for (const id of readdirSync(path.join(root, 'books'))) {
      const file = path.join(root, 'books', id, 'book.json');
      if (!existsSync(file)) continue;
      // Fail visibly on corruption instead of silently replacing learning records.
      const book: Book = JSON.parse(readFileSync(file, 'utf8'));
      if (book.id !== id || !Array.isArray(book.pages)) throw new Error(`教材資料格式錯誤：${id}`);
      book.generationStarted=false;
      if(book.review?.status==='running'){book.review.status='paused';book.review.stage='上次生成已中斷，等待手動繼續';}
      if (book.mapStatus === 'running') book.mapStatus = 'pending';
      if (book.extraction === 'running') book.extraction = 'pending';
      for (const page of book.pages) {
        if (page.status === 'running') page.status = 'pending';
        for (const m of page.messages) if (m.status === 'running') {
          m.status = 'pending'; m.error = undefined;
        }
      }
      book.generationPaused=!bookComplete(book);
      book.pauseReason=book.generationPaused?'等待手動開始／繼續生成':undefined;
      this.books.set(id, book);
      this.save(book);
    }
  }
  private saveLibrary(value:typeof this.library){atomicJSON(path.join(this.root,'library.json'),value);this.library=value;}
  private groupName(name:unknown,except?:string){
    if(typeof name!=='string'||!name.trim()||[...name.trim()].length>60)throw new Error('群組名稱須為 1–60 字');
    const normalized=name.trim();if(this.library.groups.some(g=>g.id!==except&&g.name.normalize('NFKC').toLocaleLowerCase()===normalized.normalize('NFKC').toLocaleLowerCase()))throw new Error('已有同名群組');return normalized;
  }
  createGroup(name:string){
    if(this.library.groups.length>=200)throw new Error('群組數量已達上限');const group={id:randomUUID(),name:this.groupName(name)};
    this.saveLibrary({...this.library,groups:[...this.library.groups,group]});return group.id;
  }
  renameGroup(id:string,name:string){
    if(!this.library.groups.some(g=>g.id===id))throw new Error('找不到群組');const clean=this.groupName(name,id);
    this.saveLibrary({...this.library,groups:this.library.groups.map(g=>g.id===id?{...g,name:clean}:g)});
  }
  deleteGroup(id:string){
    if(!this.library.groups.some(g=>g.id===id))throw new Error('找不到群組');
    this.saveLibrary({groups:this.library.groups.filter(g=>g.id!==id),memberships:Object.fromEntries(Object.entries(this.library.memberships).filter(([,group])=>group!==id))});
  }
  moveBooks(ids:string[],groupId:string|null){
    if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!this.books.has(id)))throw new Error('請選擇有效教材');
    if(groupId!==null&&!this.library.groups.some(g=>g.id===groupId))throw new Error('找不到群組');
    const memberships={...this.library.memberships};for(const id of ids){if(groupId===null)delete memberships[id];else memberships[id]=groupId;}
    this.saveLibrary({...this.library,memberships});
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
    if(this.library.memberships[id])this.moveBooks([id],null);
    rmSync(target,{recursive:true,force:true});
    this.books.delete(id);
  }
  deleteMessage(id:string,n:number,messageId:string){
    const book=this.book(id);
    if(!Number.isInteger(n)||n<1||n>book.count)throw new Error('頁碼不在教材範圍內');
    if(typeof messageId!=='string'||!messageId)throw new Error('問答紀錄無效');
    const page=book.pages[n-1],message=page.messages.find(m=>m.id===messageId);
    if(!message)throw new Error('找不到這筆問答紀錄');
    if(message.status==='running')throw new Error('請等待回答完成後再刪除');
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
    const book: Book = { id, name: path.basename(file), count: 0, currentPage: 1, createdAt: new Date().toISOString(), extraction: 'pending', extracted: 0, mapStatus: 'pending', mapChunks: [], pages: [], generationPaused:true,generationStarted:false };
    mkdirSync(path.join(this.root, 'books', id), { recursive: true });
    copyFileSync(file, path.join(this.root, 'books', id, 'source.pdf'));
    this.books.set(id, book); this.save(book); return book;
  }
  summaries(): BookSummary[] {
    return [...this.books.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(b => ({ groupId:this.library.memberships[b.id], id: b.id, name: b.name, count: b.count, currentPage: b.currentPage, createdAt: b.createdAt, completed: b.pages.filter(p => p.status === 'done').length,generationPaused:!!b.generationPaused,pauseReason:b.pauseReason,generationState:b.generationPaused?'paused':'waiting' }));
  }
}
