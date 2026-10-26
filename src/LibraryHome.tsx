import {useMemo,useState} from 'react';
import {BookOpen,Plus,Search,Trash2,ArrowRight,FileText} from 'lucide-react';
import type {BookSummary} from './shared';

export function LibraryHome({books,onSelect,onImport,onDelete}:{books:BookSummary[];onSelect:(id:string)=>void;onImport:()=>void;onDelete:(book:BookSummary)=>void}){
  const [query,setQuery]=useState('');
  const visible=useMemo(()=>books.filter(b=>b.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[books,query]);
  return <section className="library-home" aria-label="教材首頁"><div className="home-content">
    <div className="home-heading"><div><span className="eyebrow">YOUR LEARNING LIBRARY</span><h1>接著上次，繼續讀。</h1><p>你的 {books.length} 份教材與學習紀錄都在這裡。</p></div><button className="primary-button" onClick={onImport}><Plus size={18}/>匯入 PDF 教材</button></div>
    <div className="home-library-toolbar"><h2><BookOpen size={19}/>我的教材</h2><label className="home-search"><Search size={17}/><input aria-label="搜尋歷史教材" placeholder="搜尋教材名稱" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
    <div className="home-books">{visible.map(b=><article className="home-book" key={b.id}><button className="home-book-open" aria-label={`開啟教材 ${b.name}`} onClick={()=>onSelect(b.id)}><span className="home-book-icon"><FileText size={25}/></span><strong title={b.name}>{b.name.replace(/\.pdf$/i,'')}</strong><span className="home-book-meta">{b.count?`${b.count} 頁 · 上次讀到第 ${b.currentPage} 頁`:'尚未完成解析'}</span><div className="progress-track"><i style={{width:`${b.count?b.completed/b.count*100:0}%`}}/></div><span className="home-book-bottom"><span>{b.completed} 頁講解已保存</span><span>繼續閱讀 <ArrowRight size={14}/></span></span></button><button className="home-book-delete icon-button" aria-label={`刪除教材 ${b.name}`} title="刪除教材與學習紀錄" onClick={()=>onDelete(b)}><Trash2 size={15}/></button></article>)}</div>
    {!visible.length&&<p className="home-no-results">找不到符合「{query}」的教材。</p>}
    <p className="home-footnote">點選教材即可閱讀已保存的內容；AI 生成由你手動開始。</p>
  </div></section>;
}
