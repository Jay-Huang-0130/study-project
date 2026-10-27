import type {Writable} from 'node:stream';
import {cancelled} from './cancellation';

export type WriteStage='queued'|'writing'|'blocked'|'written'|'failed';
export type PipeCode='processUnavailable'|'pipeUnavailable'|'pipeClosed'|'pipeWriteFailed'|'pipeWriteTimeout';
export interface WriteEvent {stage:WriteStage;bytes:number;code?:PipeCode}
export function pipeError(code:PipeCode):Error{
 const message={processUnavailable:'本機 Codex 程序不可用，請重新確認連線。',pipeUnavailable:'本機 Codex 輸入管道不可寫入，請重新確認連線。',pipeClosed:'本機 Codex 輸入管道已關閉，請重新確認連線。',pipeWriteFailed:'寫入本機 Codex 管道失敗，請重新確認連線。',pipeWriteTimeout:'寫入本機 Codex 管道超過 30 秒，已停止送出，請重新確認連線。'}[code];
 return Object.assign(new Error(message),{diagnostic:{code}});
}
interface WriteJob {line:string;bytes:number;started:boolean;settled:boolean;timer:ReturnType<typeof setTimeout>;signal?:AbortSignal;abort:()=>void;resolve:()=>void;reject:(e:Error)=>void;observe:(e:WriteEvent)=>void}

/** FIFO writes with real completion callbacks. A false write return is backpressure,
 * never a reason to resend the same bytes. The next write waits for drain. */
export class RpcWriter {
 private queue:WriteJob[]=[];private active?:WriteJob;private broken?:Error;private blocked=false;
 constructor(private pipe:Writable,private alive:()=>boolean,private fatal:(error:Error)=>void,private timeoutMs=30_000){
  pipe.on('error',()=>this.break(pipeError('pipeWriteFailed')));
  pipe.on('close',()=>this.break(pipeError('pipeClosed')));
  pipe.on('drain',()=>{this.blocked=false;this.pump();});
 }
 get snapshot(){return {queued:this.queue.length,writing:!!this.active,blocked:this.blocked};}
 write(line:string,signal?:AbortSignal,observe:(event:WriteEvent)=>void=()=>{}):Promise<void>{
  return new Promise((resolve,reject)=>{
   if(signal?.aborted){reject(cancelled());return;}
   const bytes=Buffer.byteLength(line),notify=(event:WriteEvent)=>{try{observe(event);}catch{/* Diagnostics cannot affect pipe delivery. */}};
   const job:WriteJob={line,bytes,signal,started:false,settled:false,resolve,reject,observe:notify,timer:undefined!,abort:()=>{
    if(!job.started){this.queue=this.queue.filter(x=>x!==job);this.settle(job,cancelled());this.pump();}
   }};
   if(this.broken){notify({stage:'failed',bytes,code:(this.broken as any).diagnostic?.code});reject(this.broken);return;}
   job.timer=setTimeout(()=>this.break(pipeError('pipeWriteTimeout')),this.timeoutMs);
   signal?.addEventListener('abort',job.abort,{once:true});this.queue.push(job);notify({stage:'queued',bytes});this.pump();
  });
 }
 private settle(job:WriteJob,error?:Error){if(job.settled)return;job.settled=true;clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);error?job.reject(error):job.resolve();}
 private break(error:Error,report=true){
  if(this.broken)return;this.broken=error;
  const jobs=[...(this.active?[this.active]:[]),...this.queue];this.active=undefined;this.queue=[];this.blocked=false;
  for(const job of jobs){job.observe({stage:'failed',bytes:job.bytes,code:(error as any).diagnostic?.code});this.settle(job,error);}
  if(report)this.fatal(error);
 }
 dispose(){this.break(pipeError('pipeClosed'),false);}
 private pump(){
  if(this.broken||this.active||!this.queue.length)return;
  if(!this.alive()){this.break(pipeError('processUnavailable'));return;}
  if(this.pipe.destroyed||this.pipe.writableEnded||this.pipe.writableFinished||!this.pipe.writable){this.break(pipeError('pipeUnavailable'));return;}
  if(this.blocked||this.pipe.writableNeedDrain)return;
  const job=this.queue.shift()!;if(job.signal?.aborted){this.settle(job,cancelled());this.pump();return;}
  this.active=job;job.started=true;job.observe({stage:'writing',bytes:job.bytes});
  try{
   const accepted=this.pipe.write(job.line,'utf8',error=>{
    if(this.broken)return;
    if(error){this.break(pipeError('pipeWriteFailed'));return;}
    job.observe({stage:'written',bytes:job.bytes});this.settle(job);if(this.active===job)this.active=undefined;
    queueMicrotask(()=>this.pump());
   });
   if(!accepted){this.blocked=true;job.observe({stage:'blocked',bytes:job.bytes});}
  }catch{this.break(pipeError('pipeWriteFailed'));}
 }
}
