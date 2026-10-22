# 貢獻指南

Study Project 目前為個人使用導向的 Windows Alpha。修改前請先看 [產品規格](SPEC.md)、[架構](docs/ARCHITECTURE.md) 與 [最新開發紀錄](DEVLOG.md)。倉庫授權條款尚未選定，請勿自行新增授權宣告。

## 問題回報

請在 [Issues](https://github.com/Jay-Huang-0130/study-project/issues) 提供：

1. App 設定顯示的版本、Windows 版本，以及安裝版或可攜版。
2. 最短重現步驟、預期行為與實際結果。
3. 相關錯誤文字；截圖請遮蔽私人教材與帳號資料。
4. 若可提供測試 PDF，使用自行建立或確認可公開的最小範例。

不要上傳 OAuth token、keyring 內容、完整個人書庫、`.env` 或其他人的教材。涉及憑證的問題請先私下聯絡專案作者，不要把敏感內容放進公開 Issue。

## 提交修改

1. 建立功能或修補分支，使用隔離的 `STUDY_USER_DATA` 與 `STUDY_DATA_DIR`。
2. 控制單次修改範圍，對照現有行為；Engine 改動需同步 [ENGINE.md](docs/ENGINE.md)。
3. 程式修改執行 `npm run check`；介面與安裝更新另做相應桌面驗證。純文件修改檢查連結、內容及 `git diff --check` 即可。
4. 在 [DEVLOG.md](DEVLOG.md) 記錄實作、驗證與限制，必要時更新 SPEC。
5. 提出 Pull Request，說明問題、修改後行為、驗證方式與未驗證項目。

## 必須保留的行為

- 啟動、選教材、翻頁與改設定不能隱含開始 AI 生成。
- 已完成快取不自動重跑；非同步結果回到原教材與頁面。
- 暫停、刪除與重新匯入後，不接受過期工作回寫。
- 教材與歷史問答是資料，不得讓它們授權工具執行。
- 不以提高並行數、測試替身結果或模型自評宣稱準確率提升。
- 發行流程不得包含個人教材或登入資料。

詳細工作循環見 [DEVELOPMENT.md](DEVELOPMENT.md)。
