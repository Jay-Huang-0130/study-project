export function cancelled(){return new DOMException('生成已暫停','AbortError');}
/** Also protects against a provider that returns after cancellation. */
export function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>reject(cancelled());
    signal.addEventListener('abort',abort,{once:true});
    void promise.then(value=>{if(signal.aborted)reject(cancelled());else resolve(value);},reject)
      .finally(()=>signal.removeEventListener('abort',abort));
    if(signal.aborted)abort();
  });
}
