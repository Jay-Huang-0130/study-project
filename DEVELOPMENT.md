# 開發與維護流程

基準：**0.11.0**；更新日期：**2026-10-27**。產品行為以 [SPEC](SPEC.md) 為準，實作方法見 [ARCHITECTURE](docs/ARCHITECTURE.md) 與 [ENGINE](docs/ENGINE.md)，歷史進度見 [DEVLOG](DEVLOG.md)。

## 1. 開始工作

1. 查看最新紀錄與產品規格，確認當次範圍及通過條件。
2. `git status --short --branch`，不覆蓋既有未提交修改。
3. 已有正確遠端追蹤分支且工作目錄乾淨時，才以 `git pull --ff-only` 同步。
4. 功能建議使用 `feat/...`，修補使用 `fix/...`；是否開 PR 依工作安排。

需要 Windows x64、Node.js 22.13+ 與 npm。完整初次安裝見 [README](README.md#本機開發)。

## 2. 開發與資料隔離

```powershell
npm ci
$env:STUDY_USER_DATA = Join-Path (Get-Location) 'local-data/dev-profile'
$env:STUDY_DATA_DIR = Join-Path (Get-Location) 'local-data/dev-library'
npm run dev
```

兩個變數均使用絕對路徑，避免預設資料位置碰到日常書庫。不要讓不同 userData 的多個程序共寫同一 library；profile 單一實例鎖不是書庫交易鎖。測試不使用真實教材或模型額度，除非當次明確需要並已授權。

## 3. 工作循環

1. 定義問題、觸發條件與修改後行為。
2. 實作最小完整修改，保留既有快取、手動啟動及頁面綁定規則。
3. 依變更選擇驗證；記錄替身與真實服務的界線。
4. 產品行為變更同步 SPEC；Engine 變更同步 ENGINE；更新 DEVLOG。
5. `git diff --check`，檢查差異、敏感資料及無關檔案。
6. 只 stage 當次檔案，提交並推送，確認遠端結果。

## 4. 驗證矩陣

| 修改 | 基本驗證 | 額外重點 |
| --- | --- | --- |
| 純文件 | 原始碼對照、相對連結、Git diff | 不需為文字修改重跑模型或打包 |
| Engine / Pool | `npm run check`、受控 Provider | 亂序、容量、問答優先、取消、快取、刪除後晚到結果 |
| Provider | 協定替身、`npm run check` | turn/start 尚未回覆時取消、精確 turn/interrupt、延遲串流 |
| Store / 資料 | `npm run check`、隔離重開 | 舊設定、半途狀態、原子保存及刪除範圍 |
| PDF / 介面 | `npm run check`、隔離 Electron 操作 | 多教材快速切換、縮放、重載、公式與畫布生命週期 |
| 發行 / 更新 | 編譯、打包、真正 installer 更新測試 | 一般退出不安裝、明確安裝、保存路徑、重開與公開 feed |

`npm run check:codex` 只驗證獨立元件初始化及模型目錄，不代表登入資格、額度或教學品質。111 項為 0.10.3 現有測試紀錄；目前證據見 [TESTING](docs/TESTING.md)。

## 5. 打包與發行

```powershell
npm run check
npm run package
```

編譯與打包須依序；**不要在 electron-builder 讀取 dist / dist-electron 時，同時重新 build 清除或改寫輸出**。同一輸出目錄只跑一個打包工作。

更新 package.json / lockfile 版本與 `Start-Study.cmd`，確認安裝、更新與可攜版行為後，依 [RELEASING](docs/RELEASING.md) 推送版本 tag。文件修改不需要發新版 App 或推新 tag。

## 6. 必要回歸條件

- 啟動、選教材、翻頁、登入、改設定不隱含啟動 AI。
- 已完成頁不重跑，結果回到送出時的教材與頁碼。
- 地圖增量更新不抹除有效在途講稿；取消與新 generationId 隔離。
- 刪除教材後，舊物件不能因晚到結果重建資料。
- 降低容量等待現有工作完成，不誤宣稱立即降低遠端運算。
- 預覽錯誤恢復不消耗模型額度或修改講稿。
- 更新不偷偷安裝、清空書庫或自動繼續生成。

## 7. 品質量測

模型語義品質需對照原頁，使用可公開或獲授權的測試樣本；記錄模型、教材、原頁與地圖覆蓋。速度量測區分本機解析、網路／上游推論、首次可讀與全書完成，重複取樣並說明冷／熱快取。

不要由測試替身、單次渲染數字或使用者滿意回饋推導學術準確率。實驗規劃見 [PERFORMANCE](docs/PERFORMANCE.md)。

## 8. 憑證、教材與提交

不提交 OAuth token、keyring、API Key、`.env`、個人書庫、私人 PDF 或原始 stderr。fixture 應自行建立且可公開。書庫的本機保存不等於加密，也不代表生成不傳送資料到模型服務。

每次結束在 DEVLOG 交代做了什麼、如何驗證、限制與下一步。用 `git status --short --branch`、`git log -1 --oneline` 及遠端提交識別確認交付狀態。

0.9.0：科目群組實作見 Store.library、LibraryHome 與 GROUPS 文件；浮動詳情見 FloatingInfo、panel-layout、ConceptReview。請避免群組操作呼叫 Engine.wake，或將分組／卡片大小加入來源指紋。

生成阻塞維護：修改 Codex 傳送或排程前，先讀 [INCIDENTS](docs/INCIDENTS.md)，保留寫入確認、背壓、取消與遲到結果測試；「準備送出」不能當成寫入或遠端接受證據。
