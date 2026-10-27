import type {ModelTrace,ModelEventType} from './shared';
export const eventLabels:Record<ModelEventType,string>={'thread-created':'對話建立完成','request-sent':'準備送出生成指令','pipe-write-started':'開始寫入本機管道','pipe-write-complete':'本機管道寫入完成','pipe-backpressure':'本機管道背壓，後續寫入等待 drain','pipe-write-failed':'本機管道傳送失敗','rpc-accepted':'收到啟動 RPC 回覆','turn-started':'收到開始事件','item-started':'收到模型項目','reasoning':'收到推理活動（不記錄內容）','content':'收到回答文字','completed':'收到結束事件','upstream-error':'Codex 回報服務錯誤','local-error':'本機／協定錯誤','cancelled':'取消請求','interrupt-sent':'已送中斷指令','interrupt-confirmed':'中斷已確認','cleanup-pending':'等待晚到識別，取消尚未確認','transport-closed':'本機模型連線中斷','parsing':'回覆交給程式解析','validation-failed':'分頁／格式檢查未通過','page-saved':'完整頁面已保存','saved':'結果處理完成'};
export function traceEvidence(record:ModelTrace):string{
 const events=record.events??[],error=[...events].reverse().find(e=>e.type==='upstream-error');
 if(events.some(e=>e.type==='pipe-write-failed'))return '已確認本機傳送流程失敗，請查看管道錯誤碼並重新確認連線；這不是遠端限流的證據。';
 if(events.some(e=>e.type==='validation-failed'))return '模型文字已到達，但分頁或格式檢查未通過；已完成頁會保留，需檢查輸出格式與解析流程。';
 if(error)return `Codex 曾回報${error.httpStatus?` HTTP ${error.httpStatus}`:''}${error.code?` ${error.code}`:'服務錯誤'}${error.willRetry?'，當時標記將自動重試。':'。'}${record.phase==='done'?'本次請求後續已完成。':'請依最新事件查看進度。'}這是收到的錯誤證據，不是依等待時間猜測。`;
 if(events.some(e=>e.type==='page-saved'||e.type==='saved'))return record.kind==='probe'?'已收到回覆並完成檢查；測試不寫入教材講稿。':'已收到並處理回覆；完整內容已保存。';
 if(events.some(e=>e.type==='content'))return record.phase==='error'?'已收到模型文字，後續解析或請求完成階段失敗，需核對事件。':'已收到文字；完整頁面通過檢查後才會保存。';
 if(events.some(e=>e.type==='reasoning'))return '已收到模型推理活動；目前沒有可讀講稿，不能視為完全沒反應。';
 if(events.some(e=>e.type==='cleanup-pending'))return '取消時尚未取得完整啟動識別，中斷確認仍待處理；舊請求的晚到內容不會回寫。';
 if(events.some(e=>['rpc-accepted','turn-started','item-started'].includes(e.type)))return '已收到本機 Codex 的任務確認或活動，目前尚未收到可讀文字。';
 if(events.some(e=>e.type==='pipe-write-complete'))return '已完成本機管道寫入，但尚無後續活動證據；寫入完成不代表 Codex 或遠端已接受請求。';
 if(events.some(e=>e.type==='request-sent'))return '已進入送出流程，尚未確認本機管道寫入完成；請查看寫入事件與待回覆 RPC。';
 return '尚無足夠事件可判斷；只依等待時間不能認定上游限流。';
}
