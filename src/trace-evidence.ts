import type {ModelTrace,ModelEventType} from './shared';
export const eventLabels:Record<ModelEventType,string>={'thread-created':'對話建立完成','request-sent':'App 已送生成指令','rpc-accepted':'收到啟動 RPC 回覆','turn-started':'收到開始事件','item-started':'收到模型項目','reasoning':'收到推理活動（不記錄內容）','content':'收到回答文字','completed':'收到結束事件','upstream-error':'Codex 回報服務錯誤','local-error':'本機／協定錯誤','cancelled':'取消請求','interrupt-sent':'已送中斷指令','interrupt-confirmed':'中斷已確認','cleanup-pending':'等待晚到識別，取消尚未確認','transport-closed':'本機模型連線中斷','parsing':'回覆交給程式解析','validation-failed':'分頁／格式檢查未通過','page-saved':'完整頁面已保存','saved':'結果處理完成'};
export function traceEvidence(record:ModelTrace):string{
 const events=record.events??[],error=[...events].reverse().find(e=>e.type==='upstream-error');
 if(events.some(e=>e.type==='validation-failed'))return '模型文字已到達，但分頁或格式檢查未通過；已完成頁會保留，需檢查輸出格式與解析流程。';
 if(error)return `Codex 曾回報${error.httpStatus?` HTTP ${error.httpStatus}`:''}${error.code?` ${error.code}`:'服務錯誤'}${error.willRetry?'，當時標記將自動重試。':'。'}${record.phase==='done'?'本次請求後續已完成。':'請依最新事件查看進度。'}這是收到的錯誤證據，不是依等待時間猜測。`;
 if(events.some(e=>e.type==='page-saved'||e.type==='saved'))return record.kind==='probe'?'已收到回覆並完成檢查；測試不寫入教材講稿。':'已收到並處理回覆；完整內容已保存。';
 if(events.some(e=>e.type==='content'))return record.phase==='error'?'已收到模型文字，後續解析或請求完成階段失敗，需核對事件。':'已收到文字；完整頁面通過檢查後才會保存。';
 if(events.some(e=>e.type==='reasoning'))return '已收到模型推理活動；目前沒有可讀講稿，不能視為完全沒反應。';
 if(events.some(e=>e.type==='cleanup-pending'))return '取消時尚未取得完整啟動識別，中斷確認仍待處理；舊請求的晚到內容不會回寫。';
 if(events.some(e=>e.type==='request-sent'))return '指令已交給本機 Codex，但目前證據不足以區分本機服務、網路或遠端等待。';
 return '尚無足夠事件可判斷；只依等待時間不能認定上游限流。';
}
