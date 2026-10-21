import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Updates} from '../electron/updates';
class Adapter extends EventEmitter{
  autoDownload=true;autoInstallOnAppQuit=true;allowDowngrade=true;
  checks=0;downloads=0;installs=0;error=false;
  async checkForUpdates(){this.checks++;if(this.error)throw new Error('offline');this.emit('update-available',{version:'0.8.0'});}
  async downloadUpdate(){this.downloads++;this.emit('download-progress',{percent:52.8});this.emit('update-downloaded',{version:'0.8.0'});}
  quitAndInstall(silent?:boolean,run?:boolean){assert.equal(silent,true);assert.equal(run,true);this.installs++;}
}
test('updates download in background but never install on check or normal exit',async()=>{
  const adapter=new Adapter(),updates=new Updates(adapter,()=>{},async()=>{});
  assert.equal(adapter.autoInstallOnAppQuit,false);assert.equal(adapter.autoDownload,false);assert.equal(adapter.allowDowngrade,false);
  await updates.check();assert.equal(updates.state.status,'ready');assert.equal(adapter.downloads,1);assert.equal(adapter.installs,0);
  await updates.check();assert.equal(adapter.checks,1);
});
test('update installation waits for records and workers to stop, and ignores repeated installs',async()=>{
  const adapter=new Adapter();let finish!:()=>void;const prepare=new Promise<void>(r=>finish=r);
  const updates=new Updates(adapter,()=>{},()=>prepare);await updates.check();
  const installing=updates.install();assert.equal(updates.state.status,'installing');assert.equal(adapter.installs,0);
  await assert.rejects(()=>updates.install());finish();await installing;assert.equal(adapter.installs,1);
});
test('offline and download failures remain retryable; unsupported distributions do not make requests',async()=>{
  const adapter=new Adapter(),updates=new Updates(adapter,()=>{},async()=>{});adapter.error=true;
  await updates.check();assert.equal(updates.state.status,'error');assert.equal(updates.state.error,'offline');assert.equal(adapter.installs,0);
  adapter.error=false;const download=adapter.downloadUpdate.bind(adapter);adapter.downloadUpdate=async()=>{throw new Error('download interrupted');};
  await updates.check();assert.equal(updates.state.status,'error');adapter.downloadUpdate=download;await updates.check();assert.equal(updates.state.status,'ready');
  const unsupported=new Updates(undefined,()=>{},async()=>{throw new Error('must not prepare');});await unsupported.check();assert.equal(unsupported.state.status,'unsupported');await assert.rejects(()=>unsupported.install());
});
test('failure to save prevents running installer',async()=>{
  const adapter=new Adapter(),updates=new Updates(adapter,()=>{},async()=>{throw new Error('disk full');});await updates.check();await updates.install();assert.equal(adapter.installs,0);assert.equal(updates.state.status,'error');assert.equal(updates.state.error,'disk full');
});
