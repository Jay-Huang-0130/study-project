import { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } from 'electron';
import { PDFLoader } from './pdf-loader';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync,existsSync,readFileSync } from 'node:fs';
import electronUpdater from 'electron-updater';
import { Updates } from './updates';
import { atomicJSON } from './store';
import { Store } from './store';
import { CodexClient } from './codex';
import { Engine } from './engine';
import {Reviews} from './review';
import type { AppState, AuthState, Page, StudySettings } from '../src/shared';

protocol.registerSchemesAsPrivileged([{ scheme: 'study', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (process.env.STUDY_USER_DATA) app.setPath('userData', process.env.STUDY_USER_DATA);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let win: BrowserWindow | undefined;
let store: Store;
let client: CodexClient;
let engine: Engine;
let reviews:Reviews;
let updates:Updates;
let auth: AuthState = { connected: false, label: '尚未登入', models: [] };
const workers = new Map<string, PDFLoader>();
const stoppingPDF=new Map<string,Promise<void>>();
function pausePDF(id:string){
  const loader=workers.get(id);if(!loader)return stoppingPDF.get(id)??Promise.resolve();
  workers.delete(id);const book=store.book(id);if(book.extraction==='running')book.extraction='pending';store.save(book);
  const stop=loader.stop().finally(()=>{if(stoppingPDF.get(id)===stop)stoppingPDF.delete(id);changed();});stoppingPDF.set(id,stop);return stop;
}
const saveTimers = new Map<string, NodeJS.Timeout>();
let authReading:Promise<void>|undefined;
let changeTimer:NodeJS.Timeout|undefined;
const changed = () => { if(changeTimer)return;changeTimer=setTimeout(()=>{changeTimer=undefined;if(win&&!win.isDestroyed())win.webContents.send('study:change');},60); };
function saveSoon(id:string){if(saveTimers.has(id))return;saveTimers.set(id,setTimeout(()=>{saveTimers.delete(id);store.save(store.book(id));},250));}
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function readAuth():Promise<void> {
  if(authReading)return authReading;
  authReading=(async()=>{
  try {
    await client.start();
    const result = await client.call('account/read', { refreshToken: false });
    const connected = result.account?.type === 'chatgpt' || result.account?.type === 'chatgptAuthTokens';
    const catalog = await client.call('model/list', { includeHidden: false, limit: 100 });
    auth = { connected, label: connected ? 'ChatGPT 已連線' : '尚未登入', models: (catalog.data ?? []).filter((m: any) => !m.hidden).map((m: any) => ({ id: m.model, name: m.displayName, isDefault: m.isDefault })) };
    if (!store.settings.model) {
      const model = auth.models.find(m => m.isDefault) ?? auth.models[0];
      if (model) store.updateSettings({ model: model.id });
    }
    if(!connected){reviews?.cancelAll('帳號未連線，等待重新登入後手動繼續');if(engine.authenticated)engine.connectionLost('帳號已登出，請重新登入。');}
    engine.authenticated = connected; changed(); engine.wake();
  } catch (e) {
    auth = { ...auth, connected: false, label: '連線需要處理', error: e instanceof Error ? e.message : String(e) };
    reviews?.cancelAll('模型連線中斷，等待手動繼續');engine.connectionLost(auth.error||'連線失敗'); changed();
  }
  })();
  const request=authReading;void request.finally(()=>{if(authReading===request)authReading=undefined;});return request;
}
function extract(id: string,previewOnly=false) {
  if (workers.has(id)) return;
  const b = store.book(id);
  if (b.extraction === 'done' || (b.generationPaused&&!previewOnly)) return;
  b.extraction = 'running'; b.extractionError = undefined; store.save(b); changed();
  const failed = (error: string) => { b.extraction = 'error'; b.extractionError = error; store.save(b); changed(); workers.delete(id);engine.pauseBook(id,error); };
  const loader = new PDFLoader(path.join(app.getAppPath(),'electron/pdf-worker.mjs'),b,store.dir(id),store.settings.pdfWorkers,msg=>{
    if (msg.type === 'count') {
      b.count = msg.count;
      if (!b.pages.length) b.pages = Array.from({ length: b.count }, (_,i): Page => ({ number: i+1, text: '', width: 0, height: 0, imageReady: false, lesson: '', status: 'pending', messages: [] }));
    }
    if(msg.type==='text'){
      Object.assign(b.pages[msg.number-1],{text:msg.text,width:msg.width,height:msg.height});
      saveSoon(id);changed();return;
    }
    if(msg.type==='textDone')b.textReady=true;
    if(msg.type==='page'){b.pages[msg.number-1].imageReady=true;b.extracted=b.pages.filter(p=>p.imageReady).length;}
    if(msg.type==='done'){b.extraction='done';workers.delete(id);}
    if(msg.type==='error'){failed(msg.error);return;}
    store.save(b);changed();engine.wake();
  },changed);
  workers.set(id,loader);loader.start();
}
function pageNumber(id: string, value: unknown) {
  const b = store.book(id); const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > b.count) throw new Error('頁碼不在教材範圍內');
  return n;
}
function registerIPC() {
  // Every handler is available only to the application's own main frame.
  const handle = (name: string, fn: (...args: any[]) => any) => ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win?.webContents.mainFrame) throw new Error('不允許此來源');
    return fn(...args);
  });
  handle('study:state', (id?: string): AppState => ({ groups:store.library.groups, books: store.summaries().map(b=>({...b,generationState:engine.bookState(store.book(b.id))})), active: id ? reviews.snapshot(store.book(id)) : undefined, auth, ...store.settings, update:updates.state, activity:id?engine.activityFor(store.book(id)):engine.activity, version:app.getVersion(),runtime:{...engine.progress,pdfWorkers:id ? workers.get(id)?.workerCount ?? 0 : 0} }));
  handle('study:createGroup',(name:string)=>{const id=store.createGroup(name);changed();return id;});
  handle('study:renameGroup',(id:string,name:string)=>{store.renameGroup(id,name);changed();});
  handle('study:deleteGroup',(id:string)=>{store.deleteGroup(id);changed();});
  handle('study:moveBooks',(ids:string[],groupId:string|null)=>{store.moveBooks(ids,groupId);changed();});
  handle('study:import', async () => {
    const choice = await dialog.showOpenDialog(win!, { title: '選擇你的教材', filters: [{ name: 'PDF 教材', extensions: ['pdf'] }], properties: ['openFile'] });
    if (choice.canceled) return null;
    const book = store.import(choice.filePaths[0]); engine.activeId = book.id; extract(book.id,true); engine.wake(); changed(); return book.id;
  });
  handle('study:navigate', (id: string, value: number) => {
    const b = store.book(id); b.currentPage = pageNumber(id,value); store.save(b); engine.activeId = id;

    changed(); engine.wake();
  });
  handle('study:login', async () => {
    await client.start();
    const result = await client.call('account/login/start', { type: 'chatgpt' });
    const url = new URL(result.authUrl);
    if (url.protocol !== 'https:' || !['auth.openai.com','auth0.openai.com','chatgpt.com'].includes(url.hostname)) throw new Error('登入網址無效。');
    await shell.openExternal(url.href);
  });
  handle('study:refreshAuth', readAuth);
  handle('study:logout', async () => { await client.start(); await client.call('account/logout'); await readAuth(); });
  handle('study:settings', (value: Partial<StudySettings>) => {
    const clean: Partial<StudySettings> = {};
    if(value.paused!==undefined)throw new Error('請使用目前教材的暫停／繼續按鈕');
    if (typeof value.model === 'string') {
      if (!auth.models.some(m => m.id === value.model)) throw new Error('請選擇模型清單中的模型');
      clean.model = value.model;
    }
    if(value.lessonDetail!==undefined){if(!['concise','standard','detailed'].includes(value.lessonDetail))throw new Error('講解長度無效');clean.lessonDetail=value.lessonDetail;}
    for(const [key,max] of [['aiConcurrency',6],['pdfWorkers',4]] as const){
      const n=value[key];if(n!==undefined){if(!Number.isInteger(n)||n<1||n>max)throw new Error('並行數超出範圍');clean[key]=n;}
    }
    for(const [key,min,max] of [['uiScale',80,150],['readingFontSize',12,26]] as const){
      const n=value[key];if(n!==undefined){if(!Number.isInteger(n)||n<min||n>max)throw new Error('字級超出範圍');clean[key]=n;}
    }
    store.updateSettings(clean);for(const loader of workers.values())loader.setParallelism(store.settings.pdfWorkers);changed();engine.wake();
  });
  handle('study:generation',async(id:string,paused:boolean)=>{
    store.book(id);if(typeof paused!=='boolean')throw new Error('生成狀態無效');
    if(paused){engine.pauseBook(id);await pausePDF(id);}
    else{
      if(!engine.authenticated)await readAuth();
      if(!engine.authenticated)throw new Error(auth.error||'請先連接 ChatGPT，再繼續生成。');
      await stoppingPDF.get(id);engine.resumeBook(id);extract(id);
    }
    changed();
  });
  handle('study:retry', async(id: string, value?: number) => {
    const b = store.book(id);reviews.cancel(id,'教材正在重新講解，請完成後重建概念圖');
    if (value !== undefined) { const p = b.pages[pageNumber(id,value)-1]; if (p.status === 'running') return; p.status = 'pending'; p.error = undefined; }
    else {
      if (b.extraction === 'error' || b.extraction === 'pending') extract(id);
      if (b.mapStatus === 'error') { b.mapStatus = 'pending'; b.mapError = undefined; }
      for (const p of b.pages) if (p.status === 'error') { p.status = 'pending'; p.error = undefined; }
    }
    store.save(b); engine.activeId = id;
    if(!engine.authenticated)await readAuth();
    if(!engine.authenticated)throw new Error(auth.error||'請先連接 ChatGPT。');
    await stoppingPDF.get(id);engine.resumeBook(id);extract(id);changed();
  });
  handle('study:ask', async (id: string, value: number, question: string, kind: 'question' | 'exercise') => {
    if (typeof question !== 'string' || (kind !== undefined && !['question','exercise'].includes(kind))) throw new Error('問題格式無效');
    await engine.ask(id, pageNumber(id,value), question, kind);
  });
  handle('study:fullscreen', () => win?.setFullScreen(!win.isFullScreen()));
  handle('study:deleteMessage',(id:string,value:number,messageId:string)=>{
    store.deleteMessage(id,pageNumber(id,value),messageId);changed();
  });
  handle('study:deleteBook',async(id:string)=>{
    store.book(id);
    engine.pauseBook(id,'正在刪除教材');if(engine.activeId===id)engine.activeId=undefined;
    const timer=saveTimers.get(id);if(timer){clearTimeout(timer);saveTimers.delete(id);}
    await pausePDF(id);await stoppingPDF.get(id);
    store.deleteBook(id);changed();engine.wake();
  });
  handle('study:exercise', async (id: string, start: number, end: number, count: number) => {
    const first = pageNumber(id,start), last = pageNumber(id,end);
    if (last < first || last-first >= 10 || !Number.isInteger(count) || count < 1 || count > 5) throw new Error('每次可選 1～10 頁，並產生 1～5 題。');
    await engine.ask(id,first,`請針對第 ${first}～${last} 頁出 ${count} 題理解練習。`,'exercise',{ start:first, end:last, count });
  });
  handle('study:dataFolder', () => shell.openPath(store.root));
  handle('study:checkUpdate',()=>updates.check());
  handle('study:installUpdate',()=>updates.install());
  handle('study:generateReview',(id:string,restart=false)=>{if(typeof restart!=='boolean')throw new Error('生成選項無效');reviews.start(id,engine.authenticated,restart);});
  handle('study:cancelReview',(id:string)=>{store.book(id);reviews.cancel(id);});
  handle('study:reviewView',(id:string,view:any)=>reviews.saveView(id,view));
}

app.whenReady().then(async () => {
  if (!singleInstance) return;
  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR;
  const dataArgument=process.argv.find(arg=>arg.startsWith('--study-data-dir='))?.slice('--study-data-dir='.length);
  if(dataArgument&&!path.isAbsolute(dataArgument))throw new Error('教材資料位置必須使用完整路徑。');
  const locationFile=path.join(app.getPath('userData'),'data-location.json');
  const savedLocation=existsSync(locationFile)?JSON.parse(readFileSync(locationFile,'utf8')).path:undefined;
  if(savedLocation!==undefined&&(typeof savedLocation!=='string'||!path.isAbsolute(savedLocation)))throw new Error('保存的教材位置無效。');
  const data = process.env.STUDY_DATA_DIR ?? dataArgument ?? (portableRoot ? path.join(portableRoot, 'StudyProjectData') : savedLocation??path.join(app.getPath('userData'), 'library'));
  if(!portableRoot&&!process.env.STUDY_DATA_DIR)atomicJSON(locationFile,{path:data});
  mkdirSync(data,{recursive:true});
  store = new Store(data);
  client = new CodexClient(path.join(app.getPath('userData'), 'oauth'), path.join(app.getPath('userData'), 'tutor-runtime'),app.getVersion());
  const streams=new Map<string,Parameters<ConstructorParameters<typeof Engine>[3]>[0]>();
  let streamTimer:NodeJS.Timeout|undefined;
  engine = new Engine(store, client, changed, event => {
    streams.set(`${event.bookId}:${event.page}:${event.messageId??'lesson'}`,event);
    if(streamTimer)return;
    streamTimer=setTimeout(()=>{streamTimer=undefined;if(win&&!win.isDestroyed())for(const value of streams.values())win.webContents.send('study:delta',value);streams.clear();},100);
  },book=>{reviews?.cancel(book.id);void pausePDF(book.id);});
  reviews=new Reviews(store,(...args)=>engine.generateReview(...args),changed);
  client.on('notification', (method: string, params: any) => {
    if (method === 'account/updated' || method === 'account/login/completed') {
      if (method === 'account/login/completed' && !params.success) { auth.error = '登入未完成，請重新登入。'; changed(); }
      else void readAuth();
    }
  });
  client.on('connectionError', (message: string) => { auth = { ...auth, connected: false, error: message, label: '模型已中斷' }; reviews.cancelAll('模型連線中斷，等待手動繼續');engine.connectionLost(message); changed(); });
  protocol.handle('study', request => {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/([a-f0-9]{64})\/(source\.pdf|p[1-9]\d*\.jpg)$/);
    if (url.hostname !== 'book' || !match || !store.books.has(match[1])) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(store.dir(match[1]), match[2])).href);
  });
  const installed=app.isPackaged&&process.platform==='win32'&&!portableRoot&&existsSync(path.join(path.dirname(app.getPath('exe')),'Uninstall Study Project.exe'));
  updates=new Updates(installed?electronUpdater.autoUpdater:undefined,changed,async()=>{
    for(const book of store.books.values())if(book.generationStarted&&!book.generationPaused)engine.pauseBook(book.id,'正在更新程式');
    // Keep explicit custom libraries across the installer's relaunch, which drops CLI arguments.
    atomicJSON(locationFile,{path:store.root});
    await stopResources();
  });
  registerIPC();
  win = new BrowserWindow({ width: 1500, height: 960, minWidth: 1050, minHeight: 700, backgroundColor: '#f7f8fa', title: 'Study Project',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  if (process.env.VITE_DEV_SERVER_URL) await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await win.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
  if (!process.env.STUDY_WINDOWED) win.maximize();

  void readAuth();
  if(installed)setTimeout(()=>void updates.check(),4000).unref();
}).catch(error => { dialog.showErrorBox('Study Project 無法啟動', `${error.message}\n原有資料未被覆寫。`); app.quit(); });
let shuttingDown = false;
let stopping:Promise<void>|undefined;
function stopResources():Promise<void>{
  if(stopping)return stopping;
  reviews?.cancelAll('程式已關閉，等待手動繼續');engine?.stop();
  for(const [id,timer] of saveTimers){clearTimeout(timer);store.save(store.book(id));}saveTimers.clear();
  for(const id of workers.keys()){const b=store.book(id);b.extraction='pending';store.save(b);}
  const cleanup:Promise<unknown>[]=[...workers.values()].map(w=>w.stop());
  cleanup.push(...stoppingPDF.values());if(reviews)cleanup.push(reviews.stop());if(client)cleanup.push(client.close());
  stopping=Promise.allSettled(cleanup).then(()=>{});return stopping;
}
app.on('before-quit',event=>{
  if(shuttingDown)return;
  event.preventDefault();
  void stopResources().then(()=>{shuttingDown=true;app.quit();});
});
app.on('window-all-closed', () => app.quit());
