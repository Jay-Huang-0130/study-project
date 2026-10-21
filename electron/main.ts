import { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } from 'electron';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store';
import { CodexClient } from './codex';
import { Engine } from './engine';
import type { AppState, AuthState, Page } from '../src/shared';

protocol.registerSchemesAsPrivileged([{ scheme: 'study', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (process.env.STUDY_USER_DATA) app.setPath('userData', process.env.STUDY_USER_DATA);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let win: BrowserWindow | undefined;
let store: Store;
let client: CodexClient;
let engine: Engine;
let auth: AuthState = { connected: false, label: '尚未登入', models: [] };
const workers = new Map<string, Worker>();
let authReading = false;
const changed = () => { if (win && !win.isDestroyed()) win.webContents.send('study:change'); };
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

async function readAuth() {
  if (authReading) return; authReading = true;
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
    engine.authenticated = connected; changed(); engine.wake();
  } catch (e) {
    auth = { ...auth, connected: false, label: '連線需要處理', error: e instanceof Error ? e.message : String(e) };
    engine.authenticated = false; changed();
  } finally { authReading = false; }
}
function extract(id: string) {
  if (workers.has(id)) return;
  const b = store.book(id);
  if (b.extraction === 'done') return;
  b.extraction = 'running'; b.extractionError = undefined; store.save(b); changed();
  const worker = new Worker(path.join(app.getAppPath(), 'electron/pdf-worker.mjs'), { workerData: { file: path.join(store.dir(id), 'source.pdf'), dir: store.dir(id) } });
  workers.set(id, worker);
  const failed = (error: string) => { b.extraction = 'error'; b.extractionError = error; store.save(b); changed(); workers.delete(id); };
  worker.on('message', msg => {
    if (msg.type === 'count') {
      b.count = msg.count;
      if (!b.pages.length) b.pages = Array.from({ length: b.count }, (_,i): Page => ({ number: i+1, text: '', width: 0, height: 0, imageReady: false, lesson: '', status: 'pending', messages: [] }));
    }
    if (msg.type === 'page') {
      Object.assign(b.pages[msg.number-1], { text: msg.text, width: msg.width, height: msg.height, imageReady: true });
      b.extracted = msg.number;
    }
    if (msg.type === 'done') { b.extraction = 'done'; workers.delete(id); engine.wake(); }
    if (msg.type === 'error') { failed(msg.error); return; }
    store.save(b); changed();
  });
  worker.on('error', error => failed(error.message));
  worker.on('exit', code => { if (workers.has(id)) failed(`PDF 處理中斷（${code}），請重試。`); });
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
  handle('study:state', (id?: string): AppState => ({ books: store.summaries(), active: id ? store.book(id) : undefined, auth, ...store.settings, activity: engine.activity }));
  handle('study:import', async () => {
    const choice = await dialog.showOpenDialog(win!, { title: '選擇你的教材', filters: [{ name: 'PDF 教材', extensions: ['pdf'] }], properties: ['openFile'] });
    if (choice.canceled) return null;
    const book = store.import(choice.filePaths[0]); engine.activeId = book.id; extract(book.id); engine.wake(); changed(); return book.id;
  });
  handle('study:navigate', (id: string, value: number) => {
    const b = store.book(id); b.currentPage = pageNumber(id,value); store.save(b); engine.activeId = id;
    if (b.extraction === 'pending') extract(id);
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
  handle('study:settings', (value: { model?: string; paused?: boolean }) => {
    const clean: { model?: string; paused?: boolean } = {};
    if (typeof value.paused === 'boolean') clean.paused = value.paused;
    if (typeof value.model === 'string') {
      if (!auth.models.some(m => m.id === value.model)) throw new Error('請選擇模型清單中的模型');
      clean.model = value.model;
    }
    store.updateSettings(clean); changed(); engine.wake();
  });
  handle('study:retry', (id: string, value?: number) => {
    const b = store.book(id);
    if (value !== undefined) { const p = b.pages[pageNumber(id,value)-1]; if (p.status === 'running') return; p.status = 'pending'; p.error = undefined; }
    else {
      if (b.extraction === 'error' || b.extraction === 'pending') extract(id);
      if (b.mapStatus === 'error') { b.mapStatus = 'pending'; b.mapError = undefined; }
      for (const p of b.pages) if (p.status === 'error') { p.status = 'pending'; p.error = undefined; }
    }
    store.save(b); engine.activeId = id; changed(); engine.wake();
  });
  handle('study:ask', async (id: string, value: number, question: string, kind: 'question' | 'exercise') => {
    if (typeof question !== 'string' || (kind !== undefined && !['question','exercise'].includes(kind))) throw new Error('問題格式無效');
    await engine.ask(id, pageNumber(id,value), question, kind);
  });
  handle('study:fullscreen', () => win?.setFullScreen(!win.isFullScreen()));
  handle('study:exercise', async (id: string, start: number, end: number, count: number) => {
    const first = pageNumber(id,start), last = pageNumber(id,end);
    if (last < first || last-first >= 10 || !Number.isInteger(count) || count < 1 || count > 5) throw new Error('每次可選 1～10 頁，並產生 1～5 題。');
    await engine.ask(id,first,`請針對第 ${first}～${last} 頁出 ${count} 題理解練習。`,'exercise',{ start:first, end:last, count });
  });
  handle('study:dataFolder', () => shell.openPath(store.root));
}

app.whenReady().then(async () => {
  if (!singleInstance) return;
  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR;
  const data = process.env.STUDY_DATA_DIR ?? (portableRoot ? path.join(portableRoot, 'StudyProjectData') : path.join(app.getPath('userData'), 'library'));
  store = new Store(data);
  client = new CodexClient(path.join(app.getPath('userData'), 'oauth'), path.join(app.getPath('userData'), 'tutor-runtime'));
  engine = new Engine(store, client, changed, event => { if (win && !win.isDestroyed()) win.webContents.send('study:delta',event); });
  client.on('notification', (method: string, params: any) => {
    if (method === 'account/updated' || method === 'account/login/completed') {
      if (method === 'account/login/completed' && !params.success) { auth.error = '登入未完成，請重新登入。'; changed(); }
      else void readAuth();
    }
  });
  client.on('connectionError', (message: string) => { auth = { ...auth, connected: false, error: message, label: '模型已中斷' }; engine.authenticated = false; changed(); });
  protocol.handle('study', request => {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/([a-f0-9]{64})\/(source\.pdf|p[1-9]\d*\.jpg)$/);
    if (url.hostname !== 'book' || !match || !store.books.has(match[1])) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(store.dir(match[1]), match[2])).href);
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
}).catch(error => { dialog.showErrorBox('Study Project 無法啟動', `${error.message}\n原有資料未被覆寫。`); app.quit(); });
let shuttingDown = false;
app.on('before-quit', event => {
  if (shuttingDown) return;
  event.preventDefault(); shuttingDown = true; engine?.stop();
  const cleanup: Promise<unknown>[] = [...workers.values()].map(w => w.terminate());
  if (client) cleanup.push(client.close());
  void Promise.allSettled(cleanup).then(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
