import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const require = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url);
type RPC = { id?: number; method?: string; params?: any; result?: any; error?: { message: string } };
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
      let msg: RPC; try { msg = JSON.parse(line); } catch { return; }
      if (msg.id !== undefined && msg.method) {
        // A tutor must not execute commands, edit files, or invoke tools.
        this.send({ id: msg.id, error: { code: -32601, message: 'Tools are disabled in Study Project.' } } as any);
      } else if (msg.id !== undefined) {
        const waiting = this.pending.get(msg.id); if (!waiting) return;
        clearTimeout(waiting.timer); this.pending.delete(msg.id);
        if (msg.error) waiting.reject(new Error(msg.error.message)); else waiting.resolve(msg.result);
      } else if (msg.method) this.emit('notification', msg.method, msg.params);
    });
    await this.call('initialize', { clientInfo: { name: 'study_project', title: 'Study Project', version: this.version }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
  }
  private failed(error: Error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear(); this.starting = undefined; this.emit('connectionError', error.message);
  }
  private send(value: RPC) { this.child?.stdin.write(JSON.stringify(value) + '\n'); }
  call(method: string, params: unknown = {}, timeout = 60_000): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 等待逾時，請重試。`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  async generate(prompt: string, images: string[], model: string, instructions: string, onDelta?: (text: string) => void, schema?: unknown): Promise<string> {
    await this.start();
    const { thread } = await this.call('thread/start', {
      ...(model ? { model } : {}), ephemeral: true, cwd: this.cwd, approvalPolicy: 'never', sandbox: 'read-only',
      baseInstructions: instructions, config: { shell_tool: 'disabled', web_search: 'disabled', 'tools.disable_defaults': true },
    });
    let text = ''; let settled = false; let timer: NodeJS.Timeout;
    return new Promise<string>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.off('notification', handle); this.off('connectionError', disconnected); void this.call('thread/unsubscribe', { threadId: thread.id }, 5000).catch(() => {}); };
      const finish = (error?: Error) => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(text); };
      const disconnected = (message: string) => finish(new Error(message));
      const handle = (method: string, params: any) => {
        if (params?.threadId !== thread.id) return;
        if (method === 'item/agentMessage/delta') { text += params.delta; onDelta?.(text); }
        if (method === 'item/completed' && params.item?.type === 'agentMessage' && params.item.phase !== 'commentary') text = params.item.text;
        if (method === 'turn/completed') {
          if (params.turn.status !== 'completed') finish(new Error(params.turn.error?.message ?? '生成未完成，請重試。'));
          else if (!text.trim()) finish(new Error('模型未回傳講解內容。'));
          else finish();
        }
      };
      this.on('notification', handle); this.on('connectionError', disconnected);
      timer = setTimeout(() => { void this.call('turn/interrupt', { threadId: thread.id, turnId: turnId ?? '' }).catch(() => {}); finish(new Error('生成超過 8 分鐘，已中斷，請重試。')); }, 8 * 60_000);
      let turnId: string | undefined;
      void this.call('turn/start', {
        threadId: thread.id, input: [{ type: 'text', text: prompt, text_elements: [] }, ...images.map(p => ({ type: 'localImage', path: p }))],
        ...(schema ? { outputSchema: schema } : {}),
      }).then(r => { turnId = r.turn.id; }).catch(finish);
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
