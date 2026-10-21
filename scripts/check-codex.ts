import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CodexClient, codexExecutable } from '../electron/codex';
const dir=mkdtempSync(path.join(os.tmpdir(),'study-codex-'));
const client=new CodexClient(path.join(dir,'oauth'),path.join(dir,'runtime'));
try {
  console.log('Executable:',codexExecutable());
  await client.start();
  const account=await client.call('account/read',{refreshToken:false});
  const models=await client.call('model/list',{limit:100,includeHidden:false});
  console.log(JSON.stringify({initialized:true,accountType:account.account?.type??null,models:models.data?.length,defaultModel:models.data?.find((m:any)=>m.isDefault)?.model}));
} finally {await client.close();try {rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:500});} catch {console.log('Temporary runtime cleanup deferred until Windows releases file handles.');}}
