import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { OutlineEntry } from './shared';
import {PDFWheelPager} from './pdf-wheel';
import './pdf-text.css';
GlobalWorkerOptions.workerSrc = workerURL;

export function PDFViewer({ id, page, count, zoom, onNavigate, onOutline }: { id: string; page: number; count:number; zoom: number; onNavigate:(page:number)=>void; onOutline:(id:string,entries:OutlineEntry[])=>void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const textHost=useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const pager=useRef(new PDFWheelPager()),entry=useRef<{page:number;bottom:boolean}|undefined>(undefined),displayedPage=useRef('');
  const latest=useRef({page,count,onNavigate,loading:true});
  const [loaded,setLoaded] = useState<{id:string;revision:number;pdf:PDFDocumentProxy}>();
  const [revision,setRevision]=useState(0);
  const recovered=useRef(false);
  const [width,setWidth] = useState(700);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  const [textNotice,setTextNotice]=useState('');
  latest.current={page,count,onNavigate,loading};
  useEffect(()=>{
    const stage=container.current;if(!stage)return;
    const wheel=(event:WheelEvent)=>{
      if(event.ctrlKey||event.metaKey||event.shiftKey||event.buttons||Math.abs(event.deltaX)>Math.abs(event.deltaY)||!window.getSelection()?.isCollapsed)return;
      const current=latest.current;if(current.loading)return;
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?stage.clientHeight:1);
      const action=pager.current.handle({now:performance.now(),delta,top:stage.scrollTop,height:stage.scrollHeight,viewport:stage.clientHeight,page:current.page,count:current.count});
      if(action==='scroll')return;event.preventDefault();
      if(action==='next'||action==='previous'){const next=current.page+(action==='next'?1:-1);entry.current={page:next,bottom:action==='previous'};current.onNavigate(next);}
    };
    stage.addEventListener('wheel',wheel,{passive:false});return()=>stage.removeEventListener('wheel',wheel);
  },[]);
  useEffect(() => {
    setLoaded(undefined); setError('');setLoading(true);
    const task = getDocument({ url: `study://book/${id}/source.pdf?preview=${revision}`,
      cMapUrl: new URL('pdf-assets/cmaps/',document.baseURI).href, cMapPacked: true,
      standardFontDataUrl: new URL('pdf-assets/standard_fonts/',document.baseURI).href });
    let alive = true;
    void task.promise.then(async value => {
      if (!alive) return; setLoaded({id,revision,pdf:value});
      try {
        const resolve=async(entries:Awaited<ReturnType<PDFDocumentProxy['getOutline']>>):Promise<OutlineEntry[]>=>{
          const result:OutlineEntry[]=[];
          for(const entry of entries??[]){
            const children=await resolve(entry.items);
            try {
              const dest=typeof entry.dest==='string'?await value.getDestination(entry.dest):entry.dest;
              const ref=dest?.[0];
              const target=typeof ref==='number'?ref+1:ref?await value.getPageIndex(ref)+1:undefined;
              if(target&&target>=1&&target<=value.numPages)result.push({title:entry.title,page:target,children});
              else result.push(...children);
            }catch{result.push(...children);}
          }
          return result;
        };
        const entries=await resolve(await value.getOutline());if(alive)onOutline(id,entries);
      }catch{if(alive)onOutline(id,[]);}
    }).catch(e => { if (alive) {setError(e.message);setLoading(false);} });
    return () => { alive = false; void task.destroy().catch(()=>{}); };
  },[id,onOutline,revision]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(container.current); return () => observer.disconnect();
  },[]);
  useEffect(() => {
    // An id/reload change renders once with the previous state before the load effect's
    // reset commits. Never use that previous (already destroyed) document for a new job.
    if (!loaded || loaded.id!==id || loaded.revision!==revision || !canvas.current) return;
    const pdf=loaded.pdf;
    let alive = true; let rendering: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    let textLayer:TextLayer|undefined;
    setLoading(true); setError('');setTextNotice('');textHost.current?.replaceChildren();
    void pdf.getPage(page).then(p => {
      if (!alive || !canvas.current) return;
      const scale = Math.max(0.2,(width-64)/p.getViewport({ scale: 1 }).width) * zoom;
      const viewport = p.getViewport({ scale }); const dpr = window.devicePixelRatio || 1;
      const layer=document.createElement('div');layer.className='textLayer';
      layer.style.setProperty('--total-scale-factor',String(scale*viewport.userUnit));
      layer.style.setProperty('--scale-round-x','1px');layer.style.setProperty('--scale-round-y','1px');
      const textTask=p.getTextContent().then(async content=>{
        if(!alive)return;
        if(!content.items.some(item=>'str' in item&&item.str.trim())){setTextNotice('此頁沒有可選取的文字（可能是掃描圖片）。');return;}
        textLayer=new TextLayer({textContentSource:content,container:layer,viewport});await textLayer.render();
      }).catch(()=>{if(alive)setTextNotice('此頁文字層無法載入，仍可閱讀原頁。');});
      // Render offscreen: a cancelled job must not reuse or overwrite the next job's canvas.
      const target=document.createElement('canvas');
      target.width=Math.floor(viewport.width*dpr);target.height=Math.floor(viewport.height*dpr);
      rendering = p.render({ canvas: target, canvasContext: target.getContext('2d')!, viewport, transform: dpr === 1 ? undefined : [dpr,0,0,dpr,0,0] });
      return Promise.all([rendering.promise,textTask]).then(()=>{
        if(!alive||!canvas.current)return;
        canvas.current.width=target.width;canvas.current.height=target.height;
        canvas.current.style.width=`${viewport.width}px`;canvas.current.style.height=`${viewport.height}px`;
        canvas.current.getContext('2d')!.drawImage(target,0,0);
        if(textHost.current)textHost.current.replaceChildren(layer);
        if(container.current&&displayedPage.current!==`${id}:${page}`){container.current.scrollTop=entry.current?.page===page&&entry.current.bottom?container.current.scrollHeight:0;displayedPage.current=`${id}:${page}`;}entry.current=undefined;
        setLoading(false);
      });
    }).catch(e => {
      if(!alive||e.name==='RenderingCancelledException')return;
      if(/transport destroyed|worker (?:was destroyed|task was terminated)/i.test(e.message)&&!recovered.current){
        recovered.current=true;setRevision(n=>n+1);return;
      }
      setError(e.message);setLoading(false);
    });
    return () => { alive = false; rendering?.cancel();textLayer?.cancel(); };
  },[loaded,id,revision,page,width,zoom]);
  return <div className="pdf-stage" ref={container}>
    {error&&<div className="error-box" role="alert">PDF 顯示失敗：{error}<button className="secondary-button" onClick={()=>{recovered.current=false;setRevision(n=>n+1);}}>重新載入 PDF</button></div>}
    <div hidden={!!error} className={`paper ${loading ? 'rendering' : ''}`}><canvas ref={canvas} aria-label={`PDF 第 ${page} 頁`} /><div ref={textHost} className="pdf-text-host" aria-label={`第 ${page} 頁可選取文字`}/></div>
    {!error&&!loading&&textNotice&&<small className="pdf-text-notice">{textNotice}</small>}
    {!error&&loading && <div className="pdf-loading">正在開啟教材頁面…</div>}
  </div>;
}
