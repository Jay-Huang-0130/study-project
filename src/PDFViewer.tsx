import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { OutlineEntry } from './shared';
GlobalWorkerOptions.workerSrc = workerURL;

export function PDFViewer({ id, page, zoom, onOutline }: { id: string; page: number; zoom: number; onOutline:(id:string,entries:OutlineEntry[])=>void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [pdf,setPDF] = useState<PDFDocumentProxy>();
  const [width,setWidth] = useState(700);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  useEffect(() => {
    setPDF(undefined); setError('');
    const task = getDocument({ url: `study://book/${id}/source.pdf`,
      cMapUrl: new URL('pdf-assets/cmaps/',document.baseURI).href, cMapPacked: true,
      standardFontDataUrl: new URL('pdf-assets/standard_fonts/',document.baseURI).href });
    let alive = true;
    void task.promise.then(async value => {
      if (!alive) return; setPDF(value);
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
    }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; void task.destroy(); };
  },[id,onOutline]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(container.current); return () => observer.disconnect();
  },[]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let alive = true; let rendering: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setLoading(true); setError('');
    void pdf.getPage(page).then(p => {
      if (!alive || !canvas.current) return;
      const scale = Math.max(0.2,(width-64)/p.getViewport({ scale: 1 }).width) * zoom;
      const viewport = p.getViewport({ scale }); const dpr = window.devicePixelRatio || 1;
      canvas.current.width = Math.floor(viewport.width*dpr); canvas.current.height = Math.floor(viewport.height*dpr);
      canvas.current.style.width = `${viewport.width}px`; canvas.current.style.height = `${viewport.height}px`;
      rendering = p.render({ canvas: canvas.current, canvasContext: canvas.current.getContext('2d')!, viewport, transform: dpr === 1 ? undefined : [dpr,0,0,dpr,0,0] });
      return rendering.promise;
    }).then(() => { if (alive) setLoading(false); }).catch(e => { if (alive && e.name !== 'RenderingCancelledException') setError(e.message); });
    return () => { alive = false; rendering?.cancel(); };
  },[pdf,page,width,zoom]);
  return <div className="pdf-stage" ref={container}>
    {error ? <div className="error-box">PDF 顯示失敗：{error}</div> : <>
      <div className={`paper ${loading ? 'rendering' : ''}`}><canvas ref={canvas} aria-label={`PDF 第 ${page} 頁`} /></div>
      {loading && <div className="pdf-loading">正在開啟教材頁面…</div>}
    </>}
  </div>;
}
