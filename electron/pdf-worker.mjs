import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as canvas from '@napi-rs/canvas';

const require = createRequire(import.meta.url);
globalThis.DOMMatrix = canvas.DOMMatrix;
globalThis.ImageData = canvas.ImageData;
globalThis.Path2D = canvas.Path2D;
class CanvasFactory {
  create(width, height) { const c = canvas.createCanvas(width, height); return { canvas: c, context: c.getContext('2d') }; }
  reset(target, width, height) { target.canvas.width = width; target.canvas.height = height; }
  destroy(target) { target.canvas.width = 1; target.canvas.height = 1; target.canvas = null; target.context = null; }
}

try {
  let preferred = workerData.currentPage || 1;
  parentPort.on('message', message => { if(message.type === 'prioritize' && Number.isInteger(message.page)) preferred = message.page; });
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const task = getDocument({
    data: new Uint8Array(readFileSync(workerData.file)), CanvasFactory,
    standardFontDataUrl: path.join(pdfRoot, 'standard_fonts').replaceAll('\\','/') + '/',
    cMapUrl: path.join(pdfRoot, 'cmaps').replaceAll('\\','/') + '/', cMapPacked: true,
    useSystemFonts: true, isEvalSupported: false,
  });
  const pdf = await task.promise;
  parentPort.postMessage({ type: 'count', count: pdf.numPages });
  // Text is much cheaper than rendering every page. Make the full text outline available first.
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const text = await page.getTextContent();
    const base = page.getViewport({ scale: 1 });
    parentPort.postMessage({type:'text',number:n,width:base.width,height:base.height,
      text:text.items.map(x=>'str' in x?x.str+(x.hasEOL?'\n':' '):'').join('')});
    page.cleanup();
  }
  parentPort.postMessage({type:'textDone'});
  const ready = new Set((workerData.ready || []).filter(n=>existsSync(path.join(workerData.dir,`p${n}.jpg`))));
  const remaining = new Set(Array.from({length:pdf.numPages},(_,i)=>i+1).filter(n=>!ready.has(n)));
  while(remaining.size){
    const score=n=>n===preferred?-1000:n>preferred&&n<preferred+10?n-preferred-100:n;
    const n=[...remaining].sort((a,b)=>score(a)-score(b))[0];remaining.delete(n);
    const page = await pdf.getPage(n);
    const base = page.getViewport({scale:1});
    const viewport = page.getViewport({ scale: Math.min(2, 1600 / base.width) });
    const target = new CanvasFactory().create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: target.context, viewport }).promise;
    writeFileSync(path.join(workerData.dir, `p${n}.jpg`), target.canvas.toBuffer('image/jpeg', 90));
    parentPort.postMessage({ type: 'page', number: n });
    page.cleanup();
    await new Promise(resolve=>setImmediate(resolve));
  }
  await task.destroy();
  parentPort.postMessage({ type: 'done' });
  parentPort.close();
} catch (error) { parentPort.postMessage({ type: 'error', error: error.message }); parentPort.close(); }
