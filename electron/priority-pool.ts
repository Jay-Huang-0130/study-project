/** Bound actual model requests while allowing user questions to jump queued background work. */
export class PriorityPool {
  private active = 0;
  private sequence = 0;
  private queue: { priority: number; order: number; execute: () => void }[] = [];
  constructor(private capacity = 2) {}
  run<T>(priority: number, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve,reject) => {
      this.queue.push({priority,order:this.sequence++,execute:() => {
        this.active++;
        let result: Promise<T>;
        try { result = task(); } catch (error) { result = Promise.reject(error); }
        void result.then(resolve,reject).finally(() => {this.active--;this.drain();});
      }});
      this.drain();
    });
  }
  private drain() {
    this.queue.sort((a,b) => a.priority-b.priority || a.order-b.order);
    while(this.active < this.capacity && this.queue.length) this.queue.shift()!.execute();
  }
}
