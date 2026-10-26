import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../electron/store';
import {PDFLoader} from '../electron/pdf-loader';

function fixture(count:number){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Count ${count} /Kids [${Array.from({length:count},(_,i)=>`${3+i*2} 0 R`).join(' ')}] >>`];
  for(let i=0;i<count;i++){
    const stream=`BT /F1 20 Tf 50 200 Td (Page ${i+1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${4+i*2} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let pdf='%PDF-1.4\n';const offsets=[0];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}
test('PDF worker pool completes distinct pages, follows navigation, and reuses cached images',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'study-pdf-pool-'));let loader:PDFLoader|undefined;
  try{
    const file=path.join(dir,'test.pdf');writeFileSync(file,fixture(12));const store=new Store(path.join(dir,'library')),book=store.import(file);book.currentPage=7;
    const run=()=>new Promise<{seen:number[];maxWorkers:number}>((resolve,reject)=>{
      const seen:number[]=[];let maxWorkers=0;
      const timeout=setTimeout(()=>{void loader?.stop();reject(new Error('PDF pool timeout'));},20000);
      loader=new PDFLoader(path.resolve('electron/pdf-worker.mjs'),book,store.dir(book.id),2,msg=>{
        if(msg.type==='count'&&!book.pages.length){book.count=msg.count;book.pages=Array.from({length:msg.count},(_,i)=>({number:i+1,text:'',width:0,height:0,imageReady:false,lesson:'',status:'pending',messages:[]}));}
        if(msg.type==='text')Object.assign(book.pages[msg.number-1],{text:msg.text});
        if(msg.type==='page'){seen.push(msg.number);book.pages[msg.number-1].imageReady=true;if(seen.length===1)loader!.setParallelism(1);}
        if(msg.type==='done'){clearTimeout(timeout);resolve({seen,maxWorkers});}
        if(msg.type==='error'){clearTimeout(timeout);reject(new Error(msg.error));}
      },()=>{maxWorkers=Math.max(maxWorkers,loader?.workerCount??0);});loader.start();
    });
    const first=await run();assert.equal(first.maxWorkers,2);assert.equal(first.seen[0],1);assert.equal(first.seen.length,12);assert.equal(new Set(first.seen).size,12);
    assert.match(book.pages[0].text,/Page 1/);const jpg=path.join(store.dir(book.id),'p7.jpg'),mtime=statSync(jpg).mtimeMs;
    // Recover a completed image even if its metadata was not persisted before a crash.
    book.pages[6].imageReady=false;await run();assert.equal(statSync(jpg).mtimeMs,mtime);assert.equal(book.pages[6].imageReady,true);
  }finally{await loader?.stop();rmSync(dir,{recursive:true,force:true});}
});
