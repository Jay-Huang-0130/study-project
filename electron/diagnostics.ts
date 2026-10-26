import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {ModelTrace,ModelPhase,ModelActivity} from '../src/shared';
type Metadata=Pick<ModelTrace,'bookId'|'kind'|'pages'|'model'>;
const ranks:Record<ModelPhase,number>={queued:0,connecting:1,thread:2,starting:3,waiting:4,receiving:5,done:6,error:6,cancelled:6};
const terminal=(phase:ModelPhase)=>ranks[phase]===6;
export class ModelDiagnostics{
 readonly limit=200;
 private entries=new Map<string,{record:Omit<ModelTrace,'elapsedMs'|'phaseMs'>;start:number;end?:number}>();
 constructor(private now=()=>performance.now()){}
 begin(meta:Metadata){
  const id=randomUUID();this.entries.set(id,{start:this.now(),record:{...meta,pages:[...meta.pages],id,createdAt:new Date().toISOString(),phase:'queued',marks:{queued:0}}});
  while(this.entries.size>this.limit){const old=[...this.entries].find(([,e])=>terminal(e.record.phase));if(!old)break;this.entries.delete(old[0]);}return id;
 }
 mark(id:string,phase:ModelActivity){
  const entry=this.entries.get(id);if(!entry||terminal(entry.record.phase)||ranks[phase]<ranks[entry.record.phase])return;
  entry.record.marks[phase]??=Math.max(0,this.now()-entry.start);entry.record.phase=phase;
 }
 finish(id:string,error?:unknown){
  const entry=this.entries.get(id);if(!entry||terminal(entry.record.phase))return;
  const e=error as {name?:string;message?:string}|undefined,phase:ModelPhase=!error?'done':e?.name==='AbortError'?'cancelled':'error';
  entry.end=this.now();entry.record.lastPhase=entry.record.phase as ModelActivity|'queued';entry.record.phase=phase;entry.record.marks[phase]=Math.max(0,entry.end-entry.start);
  if(phase==='error'){
   const message=typeof e?.message==='string'?e.message:'';
   entry.record.failure=/quota|usage.?limit|rate.?limit|用量|額度/i.test(message)?'quota':/401|403|unauthor|sign.?in|auth|登入/i.test(message)?'auth':/timeout|timed.?out|逾時|超過.*分鐘/i.test(message)?'timeout':/ECONN|ENOTFOUND|network|連線|斷線/i.test(message)?'network':'other';
  }
 }
 snapshot(bookId?:string):ModelTrace[]{
  const now=this.now();return [...this.entries.values()].filter(e=>!bookId||e.record.bookId===bookId).reverse().map(e=>{
   const elapsedMs=Math.max(0,(e.end??now)-e.start);return structuredClone({...e.record,elapsedMs,phaseMs:Math.max(0,elapsedMs-(e.record.marks[e.record.phase]??0))});
  });
 }
}
