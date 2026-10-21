import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Plus, ArrowUp, ChevronLeft, ChevronRight, Settings2, Trash2, Maximize2, Pause, Play, Check, CircleHelp, Sparkles, FolderOpen, X, RefreshCw, FileText, ArrowRight, GraduationCap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { AppState, Book, BookSummary, Page, LessonDetail, OutlineEntry } from './shared';
import { PDFViewer } from './PDFViewer';
import { readingOutline, type ReadingNode } from './reading-outline';

function Markdown({ text, navigate }: { text: string; navigate: (n: number) => void }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]}
    components={{ a: ({href,children}) => { const match = href?.match(/^#page=(\d+)$/); return match ? <button className="inline-link" onClick={() => navigate(Number(match[1]))}>{children}</button> : <span>{children}</span>; } }}
  >{text.replace(/第\s*(\d+)\s*頁/g, '[$&](#page=$1)')}</ReactMarkdown></div>;
}
const emptyState: AppState = { books: [], auth: { connected: false, label: '正在確認連線', models: [] }, paused: false, model: '', activity: '準備學習環境',version:'',aiConcurrency:4,pdfWorkers:2,lessonDetail:'concise',uiScale:100,readingFontSize:13,runtime:{activeLessons:0,indexing:false,modelActive:0,modelQueued:0,pdfWorkers:0} };
export function App() {
  const [state,setState] = useState<AppState>(emptyState);
  const [outlines,setOutlines]=useState<Record<string,OutlineEntry[]>>({});
  const onOutline=useCallback((id:string,entries:OutlineEntry[])=>setOutlines(previous=>({...previous,[id]:entries})),[]);
  const [activeId,setActiveId] = useState<string>();
  const activeRef = useRef<string | undefined>(undefined);
  const [error,setError] = useState('');
  const [settings,setSettings] = useState(false);
  const [libraryOpen,setLibraryOpen] = useState(false);
  const [deleteBook,setDeleteBook] = useState<BookSummary>();
  const [deletingBook,setDeletingBook] = useState(false);
  const libraryRef=useRef<HTMLElement>(null);
  const launcherRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!libraryOpen||deleteBook)return;
    const outside=(e:PointerEvent)=>{if(!libraryRef.current?.contains(e.target as Node)&&!launcherRef.current?.contains(e.target as Node))setLibraryOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setLibraryOpen(false);launcherRef.current?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[libraryOpen,deleteBook]);
  const [question,setQuestion] = useState('');
  const [sending,setSending] = useState(false);
  const [zoom,setZoom] = useState(1);
  const [ratio,setRatio] = useState(53);
  const [tab,setTab] = useState<'lesson'|'map'>('lesson');
  const [streams,setStreams] = useState<Record<string,string>>({});
  const [loginOpening,setLoginOpening] = useState(false);
  const [exercise,setExercise] = useState<{start:number;end:number;count:number}>();
  const scroll = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    const id = activeRef.current;
    try { const next = await window.study.state(id); if (activeRef.current === id) setState(next); }
    catch (e) { setError(String(e)); }
  },[]);
  useEffect(() => {
    void refresh(); const off = window.study.onChange(() => void refresh());
    const delta = window.study.onDelta(e => setStreams(s => ({ ...s, [`${e.bookId}:${e.page}:${e.messageId ? `${e.messageId}:${e.generationId??''}` : `lesson:${e.generationId ?? ''}`}`]: e.text })));
    return () => { off(); delta(); };
  },[refresh]);
  const run = async (task: () => Promise<unknown>) => { try { await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const select = async (id: string) => {
    activeRef.current = id; setActiveId(id); setQuestion(''); setTab('lesson');
    const next = await window.study.state(id); setState(next);
    if (next.active?.count) await window.study.navigate(id,next.active.currentPage);
    setLibraryOpen(false);
  };
  const importPDF = () => run(async () => { const id = await window.study.importPDF(); if (id) await select(id); });
  const removeBook=async()=>{
    if(!deleteBook||deletingBook)return;
    const id=deleteBook.id;setDeletingBook(true);
    try{
      await window.study.deleteBook(id);
      if(activeRef.current===id){activeRef.current=undefined;setActiveId(undefined);setQuestion('');setTab('lesson');}
      setStreams(current=>Object.fromEntries(Object.entries(current).filter(([key])=>!key.startsWith(`${id}:`))));
      setDeleteBook(undefined);await refresh();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setDeletingBook(false);}
  };
  const book = state.active; const n = book?.currentPage ?? 1; const page = book?.pages[n-1];
  const pageOutline = book?.map?.pages.find(p => p.page === n);
  const navigate = (value: number) => {
    if (!book || value < 1 || value > book.count) return;
    void run(() => window.study.navigate(book.id,value));
  };
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; },[activeId,n,tab]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || settings || deleteBook || libraryOpen) return;
      if (e.key === 'ArrowRight') navigate(n+1); if (e.key === 'ArrowLeft') navigate(n-1);
    }; window.addEventListener('keydown',handler); return () => window.removeEventListener('keydown',handler);
  });
  const ask = (kind: 'question' | 'exercise' = 'question') => {
    if (!book || sending || (kind === 'question' && !question.trim())) return;
    const value = kind === 'exercise' ? '請針對這一頁出兩題，讓我確認是否理解。' : question;
    const id = book.id, target = n;
    setSending(true); setQuestion(''); setTab('lesson');
    void run(() => window.study.ask(id,target,value,kind)).finally(() => setSending(false));
  };
  const openLogin = async () => { setLoginOpening(true); await run(() => window.study.login()); setLoginOpening(false); };
  const dragDivider = (e: React.PointerEvent) => {
    const parent = e.currentTarget.parentElement!; e.currentTarget.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) => { const bounds = parent.getBoundingClientRect(); setRatio(Math.max(32,Math.min(68,(event.clientX-bounds.left)/bounds.width*100))); };
    const stop = () => { window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',stop); };
    window.addEventListener('pointermove',move); window.addEventListener('pointerup',stop);
  };
  const generationState=book?state.books.find(b=>b.id===book.id)?.generationState:undefined;
  const paused=!!book?.generationPaused;
  const generationLabel=(status:string)=>({running:'生成中',paused:'已暫停',complete:'已完成',waiting:'等待連線'}[status]??'等待處理');
  const complete = book?.pages.filter(p => p.status === 'done').length ?? 0;
  return <div className="app" style={{'--ui-scale':state.uiScale/100,'--reading-font':`${state.readingFontSize}px`} as CSSProperties}>
    <button ref={launcherRef} className="library-launcher" aria-label={libraryOpen?'收起教材欄':'展開教材欄'} aria-expanded={libraryOpen} aria-controls="floating-library" title="教材書庫" onClick={()=>setLibraryOpen(open=>!open)}>{libraryOpen?<X size={23}/>:<BookOpen size={23}/>}<span className="library-count">{state.books.length}</span></button>
    {libraryOpen && <aside ref={libraryRef} id="floating-library" className="sidebar floating-library" aria-label="教材書庫">
      <div className="library-heading"><div className="brand"><div className="brand-icon"><BookOpen size={21}/></div><span>study<span className="brand-dot">.</span><small>你的讀書工作室</small></span></div><button className="icon-button" aria-label="關閉教材書庫" onClick={()=>{setLibraryOpen(false);launcherRef.current?.focus();}}><X size={18}/></button></div>
      <button className="import-button" onClick={importPDF}><Plus size={17}/> 匯入 PDF 教材</button>
      <div className="sidebar-label">我的教材 <span>{state.books.length}</span></div>
      <nav className="library">{state.books.length ? state.books.map(b => <div className={`book-row ${activeId===b.id?'selected':''}`} key={b.id}>
        <button className={`book-card ${activeId === b.id ? 'selected' : ''}`} onClick={() => void run(() => select(b.id))}>
          <FileText size={18}/><span><strong>{b.name.replace(/\.pdf$/i,'')}</strong><small>{b.count ? `${b.count} 頁 · 已備妥 ${b.completed} 頁` : '正在解析教材'}</small><small className={`book-generation-status ${b.generationState}`} title={b.pauseReason}><i/>{b.generationState==='running'&&activeId!==b.id?'背景生成中':generationLabel(b.generationState)}</small><i><b style={{width:`${b.count ? b.completed/b.count*100 : 0}%`}}/></i></span>
        </button><div className="book-actions">{b.generationState!=='complete'&&<button className="book-generation-toggle" aria-label={`${b.generationPaused?(b.completed>0?'繼續':'開始'):'暫停'}教材 ${b.name}`} title={b.pauseReason} onClick={()=>void run(()=>window.study.generation(b.id,!b.generationPaused))}>{b.generationPaused?<Play size={12}/>:<Pause size={12}/>}<span>{b.generationPaused?(b.completed>0?'繼續':'開始'):'暫停'}</span></button>}<button className="delete-book" aria-label={`刪除教材 ${b.name}`} title={`刪除 ${b.name} 與學習紀錄`} onClick={()=>setDeleteBook(b)}><Trash2 size={14}/><span>刪除</span></button></div>
      </div>) : <div className="library-empty">把你的第一份教材<br/>放進來吧。</div>}</nav>
      <div className="sidebar-note"><GraduationCap size={20}/><p>照自己的步調學習。<br/><span>點選教材後，書庫會自動收起。</span></p></div>
      <button className="connection" onClick={() => {setSettings(true);setLibraryOpen(false);}}><i className={state.auth.connected ? 'online' : ''}/><span>{state.auth.label}</span><Settings2 size={15}/></button>
    </aside>}
    <main className="workspace">
      <header className="topbar"><div className="breadcrumb">讀書工作室 <ChevronRight size={13}/><strong>{book ? book.name : '開始學習'}</strong></div><div className="header-actions"><button className="icon-button" title="切換全螢幕" aria-label="切換全螢幕" onClick={() => void run(() => window.study.fullscreen())}><Maximize2 size={17}/></button><button className="icon-button" title="設定" aria-label="設定" onClick={() => setSettings(true)}><Settings2 size={18}/></button></div></header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="關閉錯誤"><X size={16}/></button></div>}
      {!book ? <section className="welcome"><div className="welcome-symbol"><BookOpen size={38}/></div><span className="eyebrow">A LITTLE UNDERSTANDING, EVERY DAY</span><h1>打開教材，<br/>讓理解慢慢發生。</h1><p>原文在左，講解在右。<br/>自由翻閱、隨時提問，接著上次讀到的地方繼續。</p><button className="primary-button" onClick={importPDF}><Plus size={18}/> 選擇 PDF 教材 <ArrowRight size={17}/></button><div className="welcome-details"><span><FileText size={16}/>英文講義與圖表</span><span><Sparkles size={16}/>逐頁中文講解</span><span><Check size={16}/>學習紀錄保存在本機</span></div>{!state.auth.connected && <button className="text-button" onClick={() => setSettings(true)}>先連接 ChatGPT 帳號 <ArrowRight size={14}/></button>}</section> : <>
        <div className="session-bar"><div><span className="eyebrow">READ AT YOUR OWN PACE</span><h1>{book.name.replace(/\.pdf$/i,'')}</h1></div><div className="session-progress"><span><b>{complete}</b> / {book.count || '—'} 頁講解已備妥</span><div className="progress-track"><i style={{width:`${book.count ? complete/book.count*100 : 0}%`}}/></div></div></div>
        <div className="split-view" style={{gridTemplateColumns:`minmax(0, ${ratio}fr) 9px minmax(0, ${100-ratio}fr)`}}>
          <section className="pdf-panel"><div className="panel-toolbar"><span className="panel-label"><FileText size={16}/>教材原文</span><div className="zoom-control"><button onClick={() => setZoom(z => Math.max(.5,z-.1))} aria-label="縮小">−</button><span>{Math.round(zoom*100)}%</span><button onClick={() => setZoom(z => Math.min(2,z+.1))} aria-label="放大">＋</button></div></div>
            <PDFViewer id={book.id} page={n} zoom={zoom} onOutline={onOutline}/>
            <div className="page-navigation"><button disabled={n<=1} onClick={() => navigate(n-1)} aria-label="上一頁"><ChevronLeft size={18}/></button><span>第 <input key={`${book.id}:${n}`} aria-label="頁碼" defaultValue={n} inputMode="numeric" onBlur={e => navigate(Number(e.target.value))} onKeyDown={e => { if (e.key === 'Enter') { navigate(Number(e.currentTarget.value)); e.currentTarget.blur(); } }}/> / {book.count || '…'} 頁</span><button disabled={n>=book.count} onClick={() => navigate(n+1)} aria-label="下一頁"><ChevronRight size={18}/></button></div>
          </section>
          <div className="divider" onPointerDown={dragDivider} title="拖曳調整兩側寬度"><i/></div>
          <section className="tutor-panel"><div className="panel-toolbar"><div className="tabs"><button className={tab==='lesson'?'active':''} onClick={() => setTab('lesson')}><Sparkles size={15}/>老師講解</button><button className={tab==='map'?'active':''} onClick={() => setTab('map')}>教材脈絡</button></div><div className="tutor-tools">{page?.status==='done'&&<button className="icon-button" aria-label="重新產生本頁講解" title="重新產生本頁講解並繼續教材生成" onClick={()=>void run(()=>window.study.retry(book.id,n))}><RefreshCw size={14}/></button>}<span className="page-badge" title={page?.contextComplete===false?`此講稿建立時參考 ${page.contextPages??0}/${book.count} 頁`:undefined}>第 {n} 頁</span></div></div>
            <div className="transcript" ref={scroll}>{tab === 'map' ? <MapContent key={book.id} book={book} outline={outlines[book.id]??[]} navigate={value=>{navigate(value);setTab('lesson');}}/> : <>
              {page?.status !== 'done' && pageOutline && <div className="analysis-preview"><strong>本頁重點已可閱讀</strong><Markdown text={pageOutline.summary} navigate={navigate}/><small>逐步講解會接著顯示，不必等其他頁分析完成。</small></div>}
              {page?.status === 'done' ? <Markdown text={page.lesson} navigate={navigate}/> : page?.status === 'running' ? <><div className="generating-label"><i/>正在準備講解…</div><Markdown text={streams[`${book.id}:${n}:lesson:${page.generationId ?? ''}`] ?? ''} navigate={navigate}/></> : <Preparation book={book} page={page} connected={state.auth.connected} paused={paused} login={() => setSettings(true)} retry={() => void run(() => window.study.retry(book.id,page?.status === 'error' ? n : undefined))}/>}
              {page?.status === 'done' && <button className="exercise-button" disabled={!state.auth.connected || sending || paused} onClick={() => setExercise({start:n,end:n,count:2})}><CircleHelp size={16}/>練習一下，確認我懂了 <ArrowRight size={15}/></button>}
              {!!page?.messages.length && <div className="conversation-label">這一頁的提問 <span>{page.messages.length}</span></div>}
              {page?.messages.map(m => <article className="exchange" key={m.id}><div className="exchange-heading"><div className="question-bubble">{m.question}</div><button className="delete-message icon-button" aria-label="刪除此問答" title={m.status === 'running' ? '回答完成後即可刪除' : '刪除這筆問題與回答'} disabled={m.status === 'running'} onClick={() => void run(() => window.study.deleteMessage(book.id,n,m.id))}><Trash2 size={15}/></button></div><div className="answer-label"><Sparkles size={13}/> 老師的回答 {m.status === 'running' && <span>· 正在回答</span>}</div>{m.status === 'pending' ? <div className="paused-answer">回答已暫停，繼續本教材生成後會接著處理。</div> : m.status === 'error' ? <div className="error-box">{m.error}<button className="text-button" onClick={() => setQuestion(m.question)}>重新編輯問題</button></div> : <Markdown text={m.status === 'running' ? streams[`${book.id}:${n}:${m.id}:${m.generationId??''}`] ?? '正在思考你的問題…' : m.answer} navigate={navigate}/>}</article>)}
            </>}</div>
            <form className="composer" onSubmit={e => { e.preventDefault(); ask(); }}><textarea value={question} maxLength={12000} onChange={e => setQuestion(e.target.value)} placeholder={`關於第 ${n} 頁，哪裡還不太懂？`} aria-label="向老師提問" disabled={!book.map?.pages.some(p => p.page === n) || !page?.imageReady || !state.auth.connected || paused} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(); } }}/><div className="composer-bottom"><span>{sending ? '老師正在回答，完成後可繼續提問' : 'Enter 送出 · Shift + Enter 換行'}</span><button className="send-button" type="submit" disabled={sending || !question.trim() || !book.map?.pages.some(p => p.page === n) || !page?.imageReady || !state.auth.connected || paused} aria-label="送出問題"><ArrowUp size={18}/></button></div></form>
          </section>
        </div>
        <footer className="statusbar"><span><i className={paused ? 'paused' : ''}/><span className="generation-feedback" title={book.pauseReason}>{state.activity}</span></span><div><span>AI 合計 {state.runtime.modelActive}/{state.aiConcurrency} · PDF {state.runtime.pdfWorkers} 緒</span><span>紀錄保存在本機</span><button disabled={generationState==='complete'&&!paused} title="控制目前這份教材" onClick={() => void run(() => window.study.generation(book.id,!paused))}>{paused ? <Play size={13}/> : <Pause size={13}/>} {paused ? (complete>0||book.mapChunks.length?'繼續生成':'開始生成') : '暫停生成'}</button></div></footer>
      </>}
    </main>
    {deleteBook && <div className="modal-backdrop"><section className="settings-modal delete-book-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-book-title" aria-describedby="delete-book-description"><h2 id="delete-book-title">刪除這份教材？</h2><strong className="delete-book-name">{deleteBook.name}</strong><p id="delete-book-description">會刪除這份教材在書庫中的 PDF 副本、講稿、問答、練習與學習進度，無法復原。原本匯入位置的 PDF 不受影響。</p><div className="dialog-actions"><button className="secondary-button" disabled={deletingBook} autoFocus onClick={()=>setDeleteBook(undefined)}>取消</button><button className="danger-button" disabled={deletingBook} onClick={()=>void removeBook()}>{deletingBook?'正在刪除…':'確認刪除教材'}</button></div></section></div>}
    {exercise && book && <div className="modal-backdrop" onClick={() => setExercise(undefined)}><form className="settings-modal" role="dialog" aria-modal="true" aria-label="練習設定" onClick={e => e.stopPropagation()} onSubmit={e => {
      e.preventDefault(); const id=book.id, range=exercise; setExercise(undefined); setSending(true); setTab('lesson');
      void run(async () => { await window.study.navigate(id,range.start); await window.study.exercise(id,range.start,range.end,range.count); }).finally(() => setSending(false));
    }}><button type="button" className="modal-close icon-button" onClick={() => setExercise(undefined)} aria-label="關閉練習設定"><X size={19}/></button><span className="eyebrow">CHECK YOUR UNDERSTANDING</span><h2>給自己一點小挑戰</h2><p>選擇剛讀過的範圍，先作答，再一起看解析。練習會保存在起始頁的問答紀錄。</p><div className="range-fields"><label>起始頁<input type="number" min={1} max={book.count} value={exercise.start} onChange={e => setExercise({...exercise,start:Number(e.target.value)})}/></label><label>結束頁<input type="number" min={exercise.start} max={Math.min(book.count,exercise.start+9)} value={exercise.end} onChange={e => setExercise({...exercise,end:Number(e.target.value)})}/></label><label>題數<input type="number" min={1} max={5} value={exercise.count} onChange={e => setExercise({...exercise,count:Number(e.target.value)})}/></label></div><p className="fine-print">每次最多 10 頁、5 題。可直接在問答區提交答案。</p><button type="submit" className="primary-button">開始練習 <ArrowRight size={16}/></button></form></div>}
    {settings && <div className="modal-backdrop" onClick={() => setSettings(false)}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => e.stopPropagation()}><button className="modal-close icon-button" onClick={() => setSettings(false)} aria-label="關閉設定"><X size={19}/></button><span className="eyebrow">YOUR STUDY SPACE</span><h2 id="settings-title">學習設定</h2><p className="version-label">版本 {state.version}</p><div className="settings-section"><h3>ChatGPT 連線</h3><p>透過官方 Codex OAuth 登入。授權資料與教材分開保存。</p><div className="auth-box"><span><i className={state.auth.connected ? 'online' : ''}/>{state.auth.label}</span><button className="text-button" onClick={() => void run(() => window.study.refreshAuth())}><RefreshCw size={14}/>重新確認</button></div>{state.auth.error && <div className="error-box">{state.auth.error}</div>}{state.auth.connected ? <button className="secondary-button" onClick={() => void run(() => window.study.logout())}>登出帳號</button> : <button className="primary-button" disabled={loginOpening} onClick={() => void openLogin()}>{loginOpening ? '正在開啟登入…' : '使用 ChatGPT 登入'}<ArrowRight size={16}/></button>}<p className="fine-print">登入會開啟系統瀏覽器，完成後回到這裡。模型請求會使用帳號的可用額度。</p></div><div className="settings-section"><label htmlFor="model">教學模型</label><select id="model" value={state.model} onChange={e => void run(() => window.study.settings({ model: e.target.value }))}>{!state.auth.models.length && <option value="">等待連線後載入模型</option>}{state.auth.models.map(m => <option key={m.id} value={m.id}>{m.name}{m.isDefault ? '（預設）' : ''}</option>)}</select><p className="fine-print">切換後用於新工作；已保存的講稿不會自動重新產生。</p></div><div className="settings-section"><label htmlFor="lesson-detail">講解長度</label><select id="lesson-detail" value={state.lessonDetail} onChange={e => void run(() => window.study.settings({lessonDetail:e.target.value as LessonDetail}))}><option value="concise">精簡（預設）</option><option value="standard">標準</option><option value="detailed">詳細</option></select><p className="fine-print">依資訊量調整篇幅，簡單頁只講重點，必要推導才展開。套用於新講稿；已有講稿可按「以目前設定重新講解」。</p></div><div className="settings-section"><h3>字體大小</h3><div className="parallel-fields"><label htmlFor="ui-scale">固定介面／標題<select id="ui-scale" value={state.uiScale} onChange={e=>void run(()=>window.study.settings({uiScale:Number(e.target.value)}))}>{[80,90,100,110,120,130,140,150].map(n=><option key={n} value={n}>{n}%{n===100?'（預設）':''}</option>)}</select></label><label htmlFor="reading-font">閱讀內文<select id="reading-font" value={state.readingFontSize} onChange={e=>void run(()=>window.study.settings({readingFontSize:Number(e.target.value)}))}>{Array.from({length:15},(_,i)=>i+12).map(n=><option key={n} value={n}>{n} px{n===13?'（預設）':''}</option>)}</select></label></div><p className="fine-print">立即套用並自動保存。閱讀內文包含講稿、問答與目錄摘要；PDF 使用左側的縮放控制。</p><div className="font-preview"><h3>標題預覽</h3><p>這是閱讀內文，可以分開調整到舒服的大小。</p></div><button className="text-button" onClick={()=>void run(()=>window.study.settings({uiScale:100,readingFontSize:13}))}>恢復預設字級</button></div><div className="settings-section"><h3>平行加載</h3><div className="parallel-fields"><label htmlFor="ai-concurrency">AI 同時請求數<select id="ai-concurrency" value={state.aiConcurrency} onChange={e => void run(() => window.study.settings({aiConcurrency:Number(e.target.value)}))}>{[1,2,3,4,5,6].map(n=><option key={n} value={n}>{n}</option>)}</select></label><label htmlFor="pdf-workers">PDF 工作緒<select id="pdf-workers" value={state.pdfWorkers} onChange={e => void run(() => window.study.settings({pdfWorkers:Number(e.target.value)}))}>{[1,2,3,4].map(n=><option key={n} value={n}>{n}</option>)}</select></label></div><p className="fine-print">AI 執行 {state.runtime.modelActive}/{state.aiConcurrency} · 排隊 {state.runtime.modelQueued} · 講稿 {state.runtime.activeLessons} · PDF {state.runtime.pdfWorkers} 緒執行中。完成一頁即可先讀。</p><p className="fine-print">預設 AI 4、PDF 2。增加並行數仍受帳號與電腦效能影響；調低後會讓現有工作先完成。</p></div><div className="settings-section"><h3>教材與學習紀錄</h3><p>包含原始 PDF、逐頁講解與問答。搬移前請關閉程式，完整複製資料夾；另一台電腦需重新登入。</p><button className="secondary-button" onClick={() => void run(() => window.study.dataFolder())}><FolderOpen size={16}/>開啟資料資料夾</button></div></section></div>}
  </div>;
}
function Preparation({book,page,connected,paused,login,retry}: { book: Book; page?: Page; connected: boolean; paused: boolean; login: () => void; retry: () => void }) {
  if(paused)return <div className="idle-notice"><span>{book.pauseReason||'尚未開始生成'}</span><small>按右下角「開始生成」或「繼續生成」，補完未完成內容。</small></div>;
  const error = book.extractionError || book.mapError || page?.error;
  const title = error ? '這一步需要再試一次' : !connected ? '連接老師，開始講解' : book.extraction !== 'done' ? '正在整理教材頁面' : !book.map ? '先準備你正在看的頁面' : '這一頁正在等待講解';
  const body = error || (!connected ? '你可以先自由翻閱 PDF。登入後，按開始生成即可準備講解。' : book.extraction !== 'done' ? `已整理 ${book.extracted} / ${book.count || '…'} 頁。圖表與公式會一起保留。` : '目前頁面會優先處理。你可以繼續翻閱，完成後回來閱讀。');
  return <div className="preparation"><div className="preparation-icon"><BookOpen size={28}/></div><h3>{title}</h3><p>{body}</p>{error ? <button className="secondary-button" onClick={retry}><RefreshCw size={15}/>重試</button> : !connected ? <button className="secondary-button" onClick={login}>連接 ChatGPT <ArrowRight size={15}/></button> : <div className="skeleton"><i/><i/><i/></div>}</div>;
}
function MapContent({book,outline,navigate}: {book: Book; outline:OutlineEntry[]; navigate: (n: number) => void}) {
  const [search,setSearch]=useState('');
  const roots=readingOutline(book,outline);
  const matches=(node:ReadingNode):boolean=>`${node.title} ${node.summary} ${node.start}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())||node.children.some(matches);
  const render=(node:ReadingNode):React.ReactNode=>node.children.length?<details className="outline-branch" key={node.key} open={search?true:undefined}>
    <summary><strong>{node.title}</strong><span>第 {node.start}{node.end!==node.start?`–${node.end}`:''} 頁</span></summary>
    <div className="outline-children">{node.children.filter(n=>!search||`${node.title} ${node.summary} ${node.start}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())||matches(n)).map(render)}</div>
  </details>:<button key={node.key} className={`outline-page ${node.start===book.currentPage?'current':''}`} aria-current={node.start===book.currentPage?'page':undefined} onClick={()=>navigate(node.start)}><span className="outline-page-number">{node.start}</span><span><strong>{node.title}</strong><small>{node.summary}</small></span><ChevronRight size={14}/></button>;
  return <section className="reading-outline"><h2>教材目錄</h2><p className="outline-help">{outline.length?'依原 PDF 目錄排列，展開章節查看重點。':'依頁序每 8 頁分組，展開查看各頁重點。'}點選頁面即可閱讀。</p><input className="outline-search" aria-label="搜尋教材目錄" placeholder="搜尋主題、關鍵字或頁碼" value={search} onChange={e=>setSearch(e.target.value)}/><div className="outline-tree" key={search?'search':'browse'}>{roots.filter(n=>!search||matches(n)).map(render)}</div>{!!search&&!roots.some(matches)&&<p>找不到相符內容。</p>}{!book.count&&<p>匯入教材後，目錄會出現在這裡。</p>}</section>;
}
