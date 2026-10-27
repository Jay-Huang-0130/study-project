import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {cancelled} from './cancellation';
import { EventEmitter } from 'node:events';
import type {ModelActivity,ModelEvent} from '../src/shared';
import {modelError,safeError} from './model-events';

const require = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
type RPC = { id?: number; method?: string; params?: any; result?: any; error?: { code?:number;message: string } };
const TURN_TIMEOUT_MS=8*60_000;
const LATE_START_GRACE_MS=30_000;
export function codexExecutable(): string {
  if (process.env.STUDY_CODEX_PATH) return process.env.STUDY_CODEX_PATH;
  const packages = ['@openai/codex-win32-x64', '@openai/codex-win32-arm64', '@openai/codex'];
  for (const pkg of packages) {
    try {
      const base = path.dirname(require.resolve(`${pkg}/package.json`)).replace('app.asar', 'app.asar.unpacked');
      const vendor = path.join(base, 'vendor');
      if (!existsSync(vendor)) continue;
      for (const target of readdirSync(vendor)) {
        if (process.platform === 'win32' && !target.includes('windows')) continue;
        for (const subdir of ['bin','codex']) {
          const exe = path.join(vendor, target, subdir, process.platform === 'win32' ? 'codex.exe' : 'codex');
          if (existsSync(exe)) return exe;
        }
      }
    } catch { /* Try the next installed distribution. */ }
  }
  return 'codex';
}

export class CodexClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private starting?: Promise<void>;
  private wire={lines:0,invalidLines:0,unmatchedReplies:0,lastInputAt:undefined as string|undefined,events:{} as Record<string,number>};
  get transport(){return {...this.wire,events:{...this.wire.events},pendingRPCs:this.pending.size,processRunning:!!this.child&&this.child.exitCode===null};}
  constructor(public home: string, public cwd: string,private version = 'development') { super(); }
  async start() {
    if (this.starting) return this.starting;
    this.starting = this.boot().catch(e => { this.starting = undefined; throw e; });
    return this.starting;
  }
  private async boot() {
    mkdirSync(this.home, { recursive: true }); mkdirSync(this.cwd, { recursive: true });
    // Dedicated credentials, separate from textbook data and other Codex projects.
    writeFileSync(path.join(this.home, 'config.toml'), 'cli_auth_credentials_store = "keyring"\n');
    this.child = spawn(codexExecutable(), ['app-server', '--listen', 'stdio://', '-c', 'shell_tool="disabled"', '-c', 'web_search="disabled"', '-c', 'tools.disable_defaults=true', '--disable', 'shell_tool', '--disable', 'multi_agent', '--disable', 'apps', '--disable', 'hooks'], {
      env: { ...process.env, OPENAI_API_KEY: undefined, CODEX_API_KEY: undefined, CODEX_HOME: this.home }, cwd: this.cwd, windowsHide: true, stdio: 'pipe',
    });
    this.child.on('error', e => this.failed(new Error(`無法啟動 Codex：${e.message}`)));
    this.child.on('exit', () => this.failed(new Error('模型連線已中斷，請重新連線。')));
    // Never forward raw stderr: it can contain provider or authentication details.
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', line => {
      this.wire.lines++;this.wire.lastInputAt=new Date().toISOString();
      let msg: RPC; try { msg = JSON.parse(line); } catch { this.wire.invalidLines++;return; }
      this.receive(msg);
    });
    await this.call('initialize', { clientInfo: { name: 'study_project', title: 'Study Project', version: this.version }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
  }
  private receive(msg:RPC){
    if(msg.id!==undefined&&msg.method){
      // A tutor must not execute commands, edit files, or invoke tools.
      this.send({id:msg.id,error:{code:-32601,message:'Tools are disabled in Study Project.'}});
    }else if(msg.id!==undefined){
      const waiting=this.pending.get(msg.id);if(!waiting){this.wire.unmatchedReplies++;return;}
      if(msg.error)waiting.reject(modelError(msg.error));else waiting.resolve(msg.result);
    }else if(msg.method){
      const key=['turn/started','turn/completed','item/started','item/completed','item/agentMessage/delta','item/reasoning/summaryTextDelta','item/reasoning/textDelta','error'].includes(msg.method)?msg.method:'other';
      this.wire.events[key]=(this.wire.events[key]??0)+1;this.emit('notification',msg.method,msg.params);
    }
  }
  private failed(error: Error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear(); this.starting = undefined; this.emit('connectionError', error.message);
  }
  private send(value: RPC) { this.child?.stdin.write(JSON.stringify(value) + '\n'); }
  call(method: string, params: unknown = {}, timeout = 60_000,signal?:AbortSignal): Promise<any> {
    signal?.throwIfAborted();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const cleanup=()=>{clearTimeout(timer);this.pending.delete(id);signal?.removeEventListener('abort',abort);};
      const fail=(error:Error)=>{cleanup();reject(error);};
      const abort=()=>fail(cancelled());
      const timer = setTimeout(() => fail(new Error(`${method} 等待逾時，請重試。`)), timeout);
      this.pending.set(id, { resolve:value=>{cleanup();resolve(value);}, reject:fail, timer });
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}
      try{this.send({ id, method, params });}catch(error){fail(error instanceof Error?error:new Error(String(error)));}
    });
  }
  async generate(prompt: string, images: string[], model: string, instructions: string, onDelta?: (text: string) => void, schema?: unknown, signal?:AbortSignal,onActivity?:(phase:ModelActivity)=>void,onEvent?:(event:ModelEvent)=>void): Promise<string> {
    const report=(phase:ModelActivity)=>{try{onActivity?.(phase);}catch{/* Observability must not affect model work. */}};
    const event=(value:ModelEvent)=>{try{onEvent?.(value);}catch{/* Diagnostic observers cannot interrupt generation. */}};
    signal?.throwIfAborted();
    report('connecting');
    await this.start();signal?.throwIfAborted();
    report('thread');
    const { thread } = await this.call('thread/start', {
      ...(model ? { model } : {}), ephemeral: true, cwd: this.cwd, approvalPolicy: 'never', sandbox: 'read-only',
      baseInstructions: instructions, config: { shell_tool: 'disabled', web_search: 'disabled', 'tools.disable_defaults': true },
    });
    event({type:'thread-created'});
    if(signal?.aborted){void this.call('thread/unsubscribe',{threadId:thread.id},5000).catch(()=>{});throw cancelled();}
    let text = ''; let settled = false; let timer: NodeJS.Timeout;let hasOutput=false,accepted=false;
    const accept=()=>{if(accepted)return;accepted=true;if(!hasOutput)report('waiting');};
    const output=()=>{if(hasOutput)return;hasOutput=true;report('receiving');};
    return new Promise<string>((resolve, reject) => {
      const startController=new AbortController();
      let unsubscribed=false;const unsubscribe=()=>{if(unsubscribed)return;unsubscribed=true;void this.call('thread/unsubscribe',{threadId:thread.id},5000).catch(()=>{});};
      let turnId:string|undefined,stopRequested=false,interrupted=false;
      const detach=()=>{this.off('notification',handle);this.off('connectionError',disconnected);};
      const interrupt=()=>{if(!turnId||interrupted)return;interrupted=true;detach();startController.abort();event({type:'interrupt-sent'});void this.call('turn/interrupt',{threadId:thread.id,turnId},5000).then(()=>event({type:'interrupt-confirmed'})).catch(()=>event({type:'local-error'})).finally(unsubscribe);};
      const finish = (error?: Error) => {
        if(settled)return;settled=true;signal?.removeEventListener('abort',abort);clearTimeout(timer);
        if(stopRequested){if(!turnId)event({type:'cleanup-pending'});interrupt();}else{detach();startController.abort();unsubscribe();}
        error?reject(error):resolve(text);
      };
      const abort=()=>{event({type:'cancelled'});stopRequested=true;finish(cancelled());};
      const disconnected = (message: string) => {event({type:'transport-closed'});finish(new Error(message));detach();startController.abort();};
      const commentary=new Set<string>();
      const handle = (method: string, params: any) => {
        if (params?.threadId !== thread.id) return;
        // Notifications can prove acceptance before the turn/start RPC reply arrives.
        // A cancelled, unacknowledged start keeps only this guarded late-ID path.
        if(method==='turn/started'&&params.turn?.id){event({type:'turn-started'});turnId=params.turn.id;if(stopRequested)interrupt();else{accept();startController.abort();}}
        if(settled){if(method==='turn/completed'){detach();startController.abort();unsubscribe();}return;}
        if(params.turnId&&typeof params.turnId==='string')turnId??=params.turnId;
        if(method==='item/started'){
          event({type:'item-started'});if(turnId)accept();
          if(params.item?.phase==='commentary'&&params.item?.id)commentary.add(params.item.id);
          if(params.item?.type==='reasoning')event({type:'reasoning'});
        }
        if(['item/reasoning/summaryTextDelta','item/reasoning/textDelta'].includes(method)){event({type:'reasoning'});if(turnId)accept();}
        if(method==='error'){
          event({type:'upstream-error',...safeError(params.error),willRetry:params.willRetry===true});
          if(params.willRetry===false)finish(modelError(params.error));
        }
        if (method === 'item/agentMessage/delta'&&!commentary.has(params.itemId)) {if(params.delta){event({type:'content'});if(turnId)accept();output();}text += params.delta; onDelta?.(text); }
        if (method === 'item/completed' && params.item?.type === 'agentMessage' && params.item.phase !== 'commentary') {text = params.item.text;if(text){event({type:'content'});output();}}
        if (method === 'turn/completed') {
          event({type:'completed',...safeError(params.turn.error)});
          if (params.turn.status !== 'completed') finish(modelError(params.turn.error));
          else if (!text.trim()) finish(new Error('模型未回傳講解內容。'));
          else finish();
        }
      };
      this.on('notification', handle); this.on('connectionError', disconnected);
      timer = setTimeout(() => {stopRequested=true;finish(new Error(turnId?'這次生成等待超過 8 分鐘，已暫停；已完成內容會保留，請按繼續生成重試。':'模型啟動等待超過 8 分鐘，已暫停；已完成內容會保留，請稍後按繼續生成。'));},TURN_TIMEOUT_MS);
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();detach();unsubscribe();return;}
      report('starting');
      event({type:'request-sent'});
      void this.call('turn/start', {
        threadId: thread.id, input: [{ type: 'text', text: prompt, text_elements: [] }, ...images.map(p => ({ type: 'localImage', path: p }))],
        ...(schema ? { outputSchema: schema } : {}),
      },TURN_TIMEOUT_MS+LATE_START_GRACE_MS,startController.signal).then(r => {event({type:'rpc-accepted'});turnId=r.turn.id;if(stopRequested)interrupt();else if(!settled)accept();}).catch(error=>{
        if(startController.signal.aborted)return;
        event({type:'local-error',...((error as any).diagnostic??{})});
        finish(error);detach();unsubscribe();
      });
    });
  }
  async close() {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); },3000);
      child.once('exit',() => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  }
}
