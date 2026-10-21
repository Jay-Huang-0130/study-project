import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerURL;

export function PDFViewer({ id, page, zoom }: { id: string; page: number; zoom: number }) {
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
    void task.promise.then(value => { if (alive) setPDF(value); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; void task.destroy(); };
  },[id]);
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
