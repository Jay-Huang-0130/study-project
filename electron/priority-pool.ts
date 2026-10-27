/** Bound actual model requests while allowing user questions to jump queued background work. */
export class PriorityPool {
  private active = 0;
  private sequence = 0;
  private lastFinishedAt?:number;
  private cooldownTimer?:ReturnType<typeof setTimeout>;
  private queue: { priority: number; order: number; execute: () => void }[] = [];
  constructor(private capacity = 2,private changed=()=>{},private gapMs=0,private now=()=>performance.now()) {}
  get snapshot(){return {active:this.active,queued:this.queue.length,capacity:this.capacity};}
  setCapacity(capacity:number){
    if(!Number.isInteger(capacity)||capacity<1||capacity>6)throw new Error('並行上限必須為 1～6。');
    if(this.capacity===capacity)return;this.capacity=capacity;this.changed();this.drain();
  }
  run<T>(priority: number, task: () => Promise<T>,signal?:AbortSignal): Promise<T> {
    return new Promise<T>((resolve,reject) => {
      if(signal?.aborted){reject(new DOMException('生成已暫停','AbortError'));return;}
      const abort=()=>{const i=this.queue.indexOf(entry);if(i>=0)this.queue.splice(i,1);reject(new DOMException('生成已暫停','AbortError'));this.changed();this.drain();};
      const entry={priority,order:this.sequence++,execute:() => {
        signal?.removeEventListener('abort',abort);
        this.active++;
        this.changed();
        let result: Promise<T>;
        try { result = task(); } catch (error) { result = Promise.reject(error); }
        void result.then(resolve,reject).finally(() => {this.active--;this.lastFinishedAt=this.now();this.changed();this.drain();});
      }};
      signal?.addEventListener('abort',abort,{once:true});
      this.queue.push(entry);
      this.changed();
      this.drain();
    });
  }
  private drain() {
    if(this.cooldownTimer){clearTimeout(this.cooldownTimer);this.cooldownTimer=undefined;}
    if(!this.queue.length||this.active>=this.capacity)return;
    const wait=this.lastFinishedAt===undefined?0:this.gapMs-(this.now()-this.lastFinishedAt);
    if(wait>0){this.cooldownTimer=setTimeout(()=>{this.cooldownTimer=undefined;this.drain();},Math.ceil(wait));return;}
    this.queue.sort((a,b) => a.priority-b.priority || a.order-b.order);
    while(this.active < this.capacity && this.queue.length) this.queue.shift()!.execute();
  }
}
