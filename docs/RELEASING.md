# Windows 發行流程

朋友使用：[最新發行版](https://github.com/Jay-Huang-0130/study-project/releases/latest) → 下載 `Study-Project-Setup.exe` → 安裝一次 → 從桌面捷徑開啟 → 登入自己的 ChatGPT 帳號。無需原始碼或開發環境。

## 發布新版

1. 修改程式，更新 DEVLOG 與使用說明。
2. `npm version X.Y.Z --no-git-tag-version`，同步 `Start-Study.cmd` 內版本。
3. 執行 `npm run check`，以獨立資料夾測試桌面程式。不要用真實書庫做自動化測試。
4. 提交並推送 main 後，建立、推送相同版本標籤：

```powershell
git tag -a vX.Y.Z -m "Study Project X.Y.Z"
git push origin vX.Y.Z
```

5. 在 [Actions](https://github.com/Jay-Huang-0130/study-project/actions) 查看 Windows Release：安裝鎖定依賴 → 測試與編譯 → Windows 安裝版與可攜版 → 更新 metadata／校驗檔 → 上傳草稿 → 發布。

工作流程使用 GitHub 自動提供的 `GITHUB_TOKEN`，僅要求 repository contents 寫入權限；不需要另存個人權杖。打包清單不含本機書庫或 OAuth 資料。自動產生的 release notes 列出提交內容；有需要可在 Releases 編輯成給使用者的更新說明。

版本標籤必須符合 package.json，失敗不發布。修復程式問題請發新版本；若是網路、runner 問題，可重新執行相同標籤的工作流程。支援 workflow_dispatch，但必須選擇版本標籤，不能選 main。

## 穩定下載入口

[Windows 可攜版](https://github.com/Jay-Huang-0130/study-project/releases/latest/download/Study-Project-Windows.exe)

[SHA256SUMS.txt](https://github.com/Jay-Huang-0130/study-project/releases/latest/download/SHA256SUMS.txt)

每次發布保持附件同名，固定連結會指向最新版本。Source code ZIP 是 GitHub 產生的原始碼，不是桌面程式。版本在 App 設定中查看。

## 更新與資料

安裝版啟動後查詢 GitHub Releases，依 latest.yml 下載對應版本的安裝檔並驗證 SHA512。設定內按「重新啟動並更新」才安裝，正常關閉不自動安裝。發布必須同時上傳 latest.yml、其 url 指向的版本化 Setup EXE，以及 blockmap；不要只上傳固定名稱的別名。

[Windows 安裝版](https://github.com/Jay-Huang-0130/study-project/releases/latest/download/Study-Project-Setup.exe)

關閉舊版後，以新版執行檔替換原檔，保留 `StudyProjectData` 整個資料夾；資料路徑可在 App 設定開啟。跨電腦需重新登入，不應分享自己的帳號憑證。可攜版仍手動下載替換。安裝版使用 App 內更新；尚未實作程式簽章，Windows 警告仍可能出現。
