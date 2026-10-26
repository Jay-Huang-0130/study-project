import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Book } from '../src/shared';

/** One shared page queue; each worker owns its PDF and canvas. */
export class PDFLoader {
  private workers = new Map<Worker, number | undefined>();
  private claimed = new Set<number>();
  private retiring = new Set<Worker>();
  private closing = false;
  private textDone = false;
  constructor(private script:string,private book:Book,private dir:string,private parallelism:number,
    private emit:(message:any)=>void,private changed:()=>void){}
  get workerCount(){return this.workers.size;}
  start(){
    for(const page of this.book.pages)if(page.imageReady&&!existsSync(path.join(this.dir,`p${page.number}.jpg`)))page.imageReady=false;
    this.book.extracted=this.book.pages.filter(p=>p.imageReady).length;
    this.spawn(false);
  }
  setParallelism(n:number){this.parallelism=n;if(this.textDone)this.fill();}
  private spawn(renderOnly:boolean){
    const worker=new Worker(this.script,{workerData:{file:path.join(this.dir,'source.pdf'),dir:this.dir,renderOnly}});
    this.workers.set(worker,undefined);this.changed();
    worker.on('message',message=>{
      if(this.closing)return;
      if(message.type==='error'){this.fail(message.error);return;}
      if(message.type==='textDone'){this.textDone=true;this.emit(message);this.fill();return;}
      if(message.type==='requestPage'){this.assign(worker);return;}
      if(message.type==='page'){this.claimed.delete(message.number);this.workers.set(worker,undefined);}
      this.emit(message);
    });
    worker.on('error',error=>this.fail(error.message));
    worker.on('exit',code=>{
      const pending=this.workers.get(worker);this.workers.delete(worker);this.retiring.delete(worker);this.changed();
      if(this.closing)return;
      if(code!==0||pending!==undefined){this.fail(`PDF 工作緒中斷（${code}），請重試。`);return;}
      if(this.book.pages.some(p=>!p.imageReady)){this.fill();return;}
      if(!this.workers.size){this.closing=true;this.emit({type:'done'});}
    });
  }
  private fill(){
    const remaining=this.book.pages.filter(p=>!p.imageReady).length;
    while(!this.closing&&this.workers.size-this.retiring.size<Math.min(this.parallelism,remaining))this.spawn(true);
  }
  private assign(worker:Worker){
    if(this.workers.size-this.retiring.size>this.parallelism){this.retiring.add(worker);worker.postMessage({type:'finish'});return;}
    const page=this.book.pages.filter(p=>!p.imageReady&&!this.claimed.has(p.number)).sort((a,b)=>a.number-b.number)[0];
    if(!page){this.retiring.add(worker);worker.postMessage({type:'finish'});return;}
    if(existsSync(path.join(this.dir,`p${page.number}.jpg`))){this.emit({type:'page',number:page.number});this.assign(worker);return;}
    this.claimed.add(page.number);this.workers.set(worker,page.number);worker.postMessage({type:'pageJob',page:page.number});
  }
  private fail(error:string){if(this.closing)return;void this.stop();this.emit({type:'error',error});}
  async stop(){this.closing=true;await Promise.allSettled([...this.workers.keys()].map(w=>w.terminate()));this.workers.clear();}
}
