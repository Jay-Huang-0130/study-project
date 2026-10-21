# study-project

個人 AI 讀書導師：在同一視窗自由閱讀 PDF，對照逐頁文字講解並隨時追問。全書脈絡、背景生成與本機保存，讓閱讀能接續進行。

目前版本為 Windows x64 桌面 Alpha（0.2.0）。閱讀與本機保存已完成實作及測試；OAuth 登入入口、教材脈絡與模型生成流程已串接，真實帳號授權後的完整教學品質仍待驗證。

## 直接使用

1. 雙擊桌面的 **Study Project** 捷徑，或專案內的 `Start-Study.cmd`。入口優先使用 `release/app-0.2.0/Study Project.exe`，不必每次解壓；也可單獨執行 `release/Study-Project-0.2.0-Windows.exe`。
2. 開啟右上角設定，按「使用 ChatGPT 登入」，在系統瀏覽器完成登入後回到程式。
3. 匯入 PDF。可立即翻閱，目前頁面分析完成就先生成講稿，其餘分析與全書整合在背景繼續。
4. 使用底部頁碼或左右方向鍵翻頁，在右側提問；已完成的講稿與問答會自動保存。
5. 講稿完成後可選擇練習範圍（最多 10 頁、5 題），並在問答區提交答案。

單獨使用可攜執行檔時，教材資料預設放在旁邊的 `StudyProjectData/`。桌面捷徑可沿用原本的資料目錄，位置記錄在 `release/data-location.txt`；可從設定開啟實際資料夾。搬移前先關閉程式，將執行檔與資料夾一起帶走。登入授權由本機系統憑證儲存管理，新電腦需要重新登入。

講解會標示建立時參考的頁數。完整脈絡完成後，可自行選擇更新早期講解，既有內容不會被背景工作自動覆寫。

如需重新建立捷徑，在專案根目錄執行：

```powershell
powershell -NoProfile -File scripts/create-desktop-shortcut.ps1
```

## 本機開發

需要 Windows x64、Node.js 22.13 以上與 npm。原始碼使用 Electron、React、TypeScript、PDF.js 與官方 Codex 套件。

```powershell
npm ci
npm run dev
```

檢查、建置與打包：

```powershell
npm run check
npm run check:codex
npm run build
npm start
npm run package
```

`check:codex` 使用隔離暫存設定驗證啟動與模型清單，不讀取既有帳號憑證，也不發送推論請求。模型清單能載入不代表帳號已取得模型使用權限。

若 npm 安裝後缺少 Electron 執行檔，可執行 `node node_modules/electron/install.js` 重新完成官方執行環境安裝。

開發模式資料預設位於 Windows 應用程式資料目錄的 `study-project/library`；正式產品名稱下的資料目錄可在設定中直接開啟。`STUDY_DATA_DIR` 與 `STUDY_USER_DATA` 可用來指定隔離測試位置，請使用絕對路徑。

## 專案文件

- [產品規格書](SPEC.md)：MVP 範圍、功能、資料、生成流程與驗收條件。
- [開發流程](DEVELOPMENT.md)：開發階段、日常工作方式與驗證要求。
- [開發紀錄](DEVLOG.md)：目前進度、完成事項、決策、問題與下一步。
- [架構與限制](docs/ARCHITECTURE.md)：程序分工、資料保存與本版限制。
- [驗證紀錄](docs/TESTING.md)：已通過與尚未驗證的項目。
- [效能改善](docs/PERFORMANCE.md)：漸進處理、實測與後續優化方向。

## 核心體驗

1. 選擇教材 PDF，左右分割顯示原頁與文字講稿。
2. 自己翻頁，AI 講解與問答紀錄依頁切換。
3. 優先處理目前頁面與問題，其餘講稿於背景生成。
4. 已完成內容本機保存，重新開啟不重跑模型。
5. 依指定範圍練習並取得解析。

模型使用官方 Codex app-server 的 ChatGPT OAuth 流程；不使用 API Key 替代登入。初版使用 Windows x64 可攜打包，其他平台尚未驗證。

## 從哪裡開始

先閱讀 SPEC.md，再查看 DEVLOG.md 的「目前進度」與「下一步」。每次工作完成後更新紀錄，避免只靠聊天記住進度。
