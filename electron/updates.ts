import type { UpdateState } from '../src/shared';

export interface UpdateAdapter {
  autoDownload:boolean; autoInstallOnAppQuit:boolean; allowDowngrade:boolean;
  on(event:string,listener:(...args:any[])=>void):unknown;
  checkForUpdates():Promise<unknown>;
  downloadUpdate():Promise<unknown>;
  quitAndInstall(silent?:boolean,forceRunAfter?:boolean):void;
}
export class Updates {
  state:UpdateState;
  private busy=false;
  constructor(private adapter:UpdateAdapter|undefined,private changed:()=>void,private prepare:()=>Promise<void>){
    this.state={status:adapter?'idle':'unsupported'};
    if(!adapter)return;
    adapter.autoDownload=false;adapter.autoInstallOnAppQuit=false;adapter.allowDowngrade=false;
    adapter.on('checking-for-update',()=>this.set({status:'checking'}));
    adapter.on('update-not-available',()=>this.set({status:'current'}));
    adapter.on('update-available',info=>this.set({status:'available',version:info.version}));
    adapter.on('download-progress',info=>this.set({...this.state,status:'downloading',percent:Math.max(0,Math.min(100,Math.round(info.percent)))}));
    adapter.on('update-downloaded',info=>this.set({status:'ready',version:info.version,percent:100}));
    adapter.on('error',error=>this.failed(error));
  }
  private set(state:UpdateState){this.state=state;this.changed();}
  private failed(error:unknown){this.set({status:'error',error:error instanceof Error?error.message:String(error)});}
  async check(){
    if(!this.adapter||this.busy||['downloading','ready','installing'].includes(this.state.status))return;
    this.busy=true;this.set({status:'checking'});
    try{await this.adapter.checkForUpdates();}catch(error){this.failed(error);}finally{this.busy=false;}
    // Download automatically, but restarting always requires the user's explicit action.
    if(this.state.status==='available')await this.download();
  }
  async download(){
    if(!this.adapter||this.busy||this.state.status!=='available')return;
    this.busy=true;this.set({...this.state,status:'downloading',percent:0});
    try{await this.adapter.downloadUpdate();}catch(error){this.failed(error);}finally{this.busy=false;}
  }
  async install(){
    if(!this.adapter||this.busy||this.state.status!=='ready')throw new Error('更新尚未下載完成');
    this.busy=true;this.set({...this.state,status:'installing'});
    try{await this.prepare();this.adapter.quitAndInstall(true,true);}catch(error){this.failed(error);}finally{this.busy=false;}
  }
}
