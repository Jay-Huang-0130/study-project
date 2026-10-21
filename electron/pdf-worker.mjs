import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
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
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const text = await page.getTextContent();
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1600 / base.width) });
    const target = new CanvasFactory().create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: target.context, viewport }).promise;
    writeFileSync(path.join(workerData.dir, `p${n}.jpg`), target.canvas.toBuffer('image/jpeg', 90));
    parentPort.postMessage({ type: 'page', number: n, width: base.width, height: base.height,
      text: text.items.map(x => 'str' in x ? x.str + (x.hasEOL ? '\n' : ' ') : '').join('') });
    page.cleanup();
  }
  await task.destroy();
  parentPort.postMessage({ type: 'done' });
} catch (error) { parentPort.postMessage({ type: 'error', error: error.message }); }
