/** Bound actual model requests while allowing user questions to jump queued background work. */
export class PriorityPool {
  private active = 0;
  private sequence = 0;
  private queue: { priority: number; order: number; execute: () => void }[] = [];
  constructor(private capacity = 2,private changed=()=>{}) {}
  get snapshot(){return {active:this.active,queued:this.queue.length,capacity:this.capacity};}
  setCapacity(capacity:number){
    if(!Number.isInteger(capacity)||capacity<1||capacity>6)throw new Error('並行上限必須為 1～6。');
    if(this.capacity===capacity)return;this.capacity=capacity;this.changed();this.drain();
  }
  run<T>(priority: number, task: () => Promise<T>,signal?:AbortSignal): Promise<T> {
    return new Promise<T>((resolve,reject) => {
      if(signal?.aborted){reject(new DOMException('生成已暫停','AbortError'));return;}
      const abort=()=>{const i=this.queue.indexOf(entry);if(i>=0)this.queue.splice(i,1);reject(new DOMException('生成已暫停','AbortError'));this.changed();};
      const entry={priority,order:this.sequence++,execute:() => {
        signal?.removeEventListener('abort',abort);
        this.active++;
        this.changed();
        let result: Promise<T>;
        try { result = task(); } catch (error) { result = Promise.reject(error); }
        void result.then(resolve,reject).finally(() => {this.active--;this.changed();this.drain();});
      }};
      signal?.addEventListener('abort',abort,{once:true});
      this.queue.push(entry);
      this.changed();
      this.drain();
    });
  }
  private drain() {
    this.queue.sort((a,b) => a.priority-b.priority || a.order-b.order);
    while(this.active < this.capacity && this.queue.length) this.queue.shift()!.execute();
  }
}
