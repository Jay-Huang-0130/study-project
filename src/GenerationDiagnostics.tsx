import {useEffect,useState} from 'react';
import type {GenerationDiagnostics as Snapshot,ModelTrace,ModelPhase} from './shared';
const labels:Record<ModelPhase,string>={queued:'等待 AI 容量',connecting:'啟動模型連線',thread:'建立對話',starting:'等待啟動確認',waiting:'等待首段文字',receiving:'接收模型內容',done:'請求完成',error:'請求失敗',cancelled:'已取消'};
const kinds:Record<ModelTrace['kind'],string>={lesson:'逐頁講稿',index:'分批索引',overview:'全書脈絡',question:'問答／練習',review:'概念地圖'};
const failures={timeout:'等待逾時',network:'連線錯誤',quota:'用量或速率限制',auth:'登入或權限',other:'其他錯誤'};
const finished=(r:ModelTrace)=>['done','error','cancelled'].includes(r.phase);
const seconds=(ms?:number)=>ms===undefined?'—':`${(Math.max(0,ms)/1000).toFixed(1)} 秒`;
const duration=(r:ModelTrace,from:ModelPhase,to:ModelPhase)=>r.marks[from]!==undefined&&r.marks[to]!==undefined?r.marks[to]!-r.marks[from]!:undefined;
export function GenerationDiagnostics({bookId}:{bookId?:string}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Snapshot>(),[error,setError]=useState(''),[exported,setExported]=useState(''),[exporting,setExporting]=useState(false);
 useEffect(()=>{
  if(!open)return;let disposed=false,inflight=false;setData(undefined);setError('');setExported('');
  const refresh=async()=>{if(inflight)return;inflight=true;try{const next=await window.study.diagnostics(bookId);if(!disposed){setData(next);setError('');}}catch(e){if(!disposed)setError(e instanceof Error?e.message:String(e));}finally{inflight=false;}};
  void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{disposed=true;clearInterval(timer);};
 },[open,bookId]);
 const p=data?.preparation,records=data?[...data.records.filter(r=>!finished(r)),...data.records.filter(finished)].slice(0,12):[];
 const exportFile=async()=>{setExporting(true);try{setExported(await window.study.exportDiagnostics(bookId));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setExporting(false);}};
 return <details className="settings-section generation-diagnostics" onToggle={e=>setOpen(e.currentTarget.open)}><summary>生成診斷 · 查看時間花在哪裡</summary>{open&&<>
  <p>記錄本次開啟 App 後的請求，每秒更新；不會啟動 AI。{bookId?'目前顯示這份教材。':'目前顯示所有教材。'}</p>
  {p&&<div className="diagnostic-preparation"><strong>{p.paused?'本教材已暫停':!p.started?'等待手動開始':'教材準備進度'}</strong><span>文字 {p.textReady?'已就緒':'準備中'} · 圖片 {p.images}/{p.count} · 索引 {p.indexed}/{p.count} · 講稿 {p.lessons}/{p.count}</span><span>全書脈絡 {p.mapComplete?'已整合':'尚未整合'}</span></div>}
  <p className="fine-print">「等待啟動確認」表示啟動請求已送出；「等待首段文字」表示已確認開始，但還沒有可讀內容。這些時間包含本機服務與網路，無法單靠它區分網路延遲和模型思考。</p>
  {error&&<p role="alert">{error}</p>}{!data&&!error&&<p>正在讀取診斷…</p>}{data&&!records.length&&<p>本次開啟尚無 AI 請求紀錄。既有請求無法回溯計時，下一次手動生成後會開始記錄。</p>}
  <div className="diagnostic-records">{records.map(r=><article key={r.id} className={`diagnostic-record ${r.phase}`}><div><strong>{kinds[r.kind]}</strong><span>{labels[r.phase]}{!finished(r)?` · 此階段 ${seconds(r.phaseMs)}`:r.phase!=='done'&&r.lastPhase?` · 停於${labels[r.lastPhase]}`:''}</span></div><small>{!bookId&&`教材 ${r.bookId.slice(0,8)} · `}{r.model||'預設模型'}{r.pages.length?` · 附圖頁碼 ${r.pages.join('、')}`:''}</small><dl>
   <div><dt>容量等待</dt><dd>{seconds(duration(r,'queued','connecting'))}</dd></div><div><dt>連線與建對話</dt><dd>{seconds(duration(r,'connecting','starting'))}</dd></div><div><dt>啟動確認</dt><dd>{seconds(duration(r,'starting','waiting'))}</dd></div><div><dt>送出至首段</dt><dd>{seconds(duration(r,'starting','receiving'))}</dd></div><div><dt>接收內容</dt><dd>{seconds(r.marks.receiving===undefined?undefined:r.elapsedMs-r.marks.receiving)}</dd></div><div><dt>總計</dt><dd>{seconds(r.elapsedMs)}</dd></div>
  </dl>{r.failure&&<small>錯誤類別：{failures[r.failure]}</small>}</article>)}</div>
  <button className="secondary-button" disabled={exporting||!data} onClick={()=>void exportFile()}>{exporting?'正在匯出…':'匯出診斷紀錄'}</button>{exported&&<p className="diagnostic-export">已匯出：{exported}<br/><button className="text-button" onClick={()=>void window.study.dataFolder()}>開啟資料資料夾</button></p>}
  <p className="fine-print">完成歷史最多保留 {data?.limit??200} 筆於記憶體，畫面顯示最近 12 筆（進行中優先）。匯出只含模型、頁碼、階段與時間等診斷資料，不包含教材文字、圖像、講稿、問題或登入憑證；檔案保存在本機。</p>
 </>}</details>;
}
