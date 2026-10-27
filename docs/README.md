# 技術文件導覽

基準：**0.10.1**；更新日期：**2026-10-27**。文件以目前程式為準，歷史決策保留在 [DEVLOG](../DEVLOG.md) 與 Git 歷史，不以早期規劃取代現行行為。

| 你想了解 | 建議閱讀 |
| --- | --- |
| 安裝、開始讀書、更新 | [README](../README.md) → [發行與更新](RELEASING.md) |
| 產品行為與驗收範圍 | [SPEC](../SPEC.md) |
| 接手程式與開發 | [DEVELOPMENT](../DEVELOPMENT.md) → [ARCHITECTURE](ARCHITECTURE.md) |
| 理解 Engine 的方法與取捨 | [ENGINE](ENGINE.md) → [PERFORMANCE](PERFORMANCE.md) |
| 科目群組與批次管理 | [GROUPS](GROUPS.md) |
| 首頁、PDF 文字、滾輪與公式相容 | [READING](READING.md) |
| 手動概念複習與來源驗證 | [CONCEPT-REVIEW](CONCEPT-REVIEW.md) |
| 定位生成等待階段 | [DIAGNOSTICS](DIAGNOSTICS.md) |
| 檢查已驗證到哪裡 | [TESTING](TESTING.md) → [DEVLOG](../DEVLOG.md) |
| 提交修改或回報問題 | [CONTRIBUTING](../CONTRIBUTING.md) |

## 文件各自負責什麼

- **SPEC** 定義目前應有的產品行為，不再累積互相覆蓋的版本條款。
- **ARCHITECTURE** 描述程式部署與資料邊界，並連到實作檔案。
- **ENGINE** 採技術論文形式，給出符號、依賴、排程偽程式碼、正確性條件與驗證限制；不是已發表的學術論文。
- **PERFORMANCE** 區分效能原理、控制流程測試及真實量測，不把模擬結果當成模型效能。
- **TESTING / DEVLOG** 保留歷次證據。TESTING 的現況摘要優先於後方歷史段落。

## 原始碼入口

| 主題 | 原始碼 |
| --- | --- |
| 工作排程與上下文 | [engine.ts](../electron/engine.ts) |
| 概念複習生成與畫布 | [review.ts](../electron/review.ts)、[ConceptReview.tsx](../src/ConceptReview.tsx) |
| 有限容量與優先佇列 | [priority-pool.ts](../electron/priority-pool.ts) |
| 講稿長度與密度 | [lesson-style.ts](../electron/lesson-style.ts) |
| Provider 協定與取消 | [codex.ts](../electron/codex.ts)、[cancellation.ts](../electron/cancellation.ts) |
| 本機 PDF 解析 | [pdf-loader.ts](../electron/pdf-loader.ts)、[pdf-worker.mjs](../electron/pdf-worker.mjs) |
| 保存與完整性判定 | [store.ts](../electron/store.ts)、[book-state.ts](../electron/book-state.ts) |
| 程序與 IPC | [main.ts](../electron/main.ts)、[preload.ts](../electron/preload.ts)、[shared.ts](../src/shared.ts) |
| PDF 預覽與目錄 | [PDFViewer.tsx](../src/PDFViewer.tsx)、[reading-outline.ts](../src/reading-outline.ts) |
| 更新與發行 | [updates.ts](../electron/updates.ts)、[release.yml](../.github/workflows/release.yml) |
