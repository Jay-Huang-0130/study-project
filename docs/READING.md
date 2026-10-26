# 首頁、PDF 操作與公式相容

基準：**0.8.1**；日期：**2026-10-26**。

## 教材首頁

已有教材時開啟 App 即顯示歷史教材卡片、保存頁碼與已完成講稿數量；支援教材名稱搜尋、匯入及刪除確認。沒有教材時顯示首次匯入入口。閱讀頁左上角「讀書工作室」可返回首頁。

首頁與選取教材僅讀取本機紀錄，不啟動推論；先前明確啟動的工作仍可在背景執行。排序沿用書庫的匯入時間順序，卡片的「上次讀到」使用已保存 currentPage，未新增閱讀時間追蹤。

## 滾輪翻頁

PDF 容器內的垂直滾輪才交由 PDFWheelPager 處理：

1. 當頁還有內容可捲動時，保持瀏覽器正常捲動。
2. 捲到邊界後，等這個手勢結束，下一個明確手勢才翻頁。
3. 一個連續手勢只翻一頁；累積 70 px 意圖門檻、400 ms 冷卻，以及 200 ms 靜止判斷，抑制觸控板慣性連跳。
4. 向前一頁時由底部接續，向下一頁時從頂部開始；一般縮放不刻意重設當頁捲動。
5. 首尾頁不越界；水平、Ctrl／Meta／Shift、按住滑鼠或有文字選取時不自動翻頁。講稿區保持自己的捲動。

數值是目前手勢啟發式設定，並非作業系統保證的實體手勢邊界；不同滑鼠／觸控板仍需實機調整。

## 選取原頁文字

PDFViewer 使用同一份 PDF.js viewport 建立高解析 canvas 與 TextLayer。文字層透明疊合於原頁，用瀏覽器選取與 Ctrl+C 即可複製，無額外模型請求。頁碼、縮放或文件變更會取消舊作業，只有仍有效的工作可提交 canvas 與文字；文字層錯誤不阻止閱讀原圖。

空白頁或純掃描圖片頁沒有原生文字時顯示提示。這一版沒有 OCR，也不從 AI 講稿假造可複製的原文。嵌入字型、PDF 編碼、直排與旋轉頁的選取品質仍由 PDF.js 與原始檔決定，不保證公式能複製成 LaTeX。

## 公式顯示修補

Markdown 輸入先經 normalizeMath，然後沿用 remark-math 與 KaTeX。相容範圍：

- 將 `\[...\]`、`\(...\)` 轉為解析器接受的顯示／行內分隔符。
- 將混在段落、清單中的多行 `$$...$$` 排成獨立公式區塊，保留清單內容縮排。
- 表格中單行 `$$...$$` 轉為行內公式，避免拆散儲存格。
- 僅對單獨一行、帶有 TeX 指令與數學運算符的明確末尾 `$$` 式子補顯示分隔符；不補猜公式內容。
- 保護程式碼區塊、行內程式碼與跳脫美元。無法解析的公式保留原式並標示供核對。

這是顯示端處理，不會重跑模型或改寫 book.json；舊講稿、回答與概念詳情可直接受益。不負責修正錯誤推導、缺失大括號、未知 TeX 巨集或模型語義。

## 實作與證據

- [LibraryHome.tsx](../src/LibraryHome.tsx)：首頁。
- [PDFViewer.tsx](../src/PDFViewer.tsx)、[pdf-text.css](../src/pdf-text.css)：原頁與文字層。
- [pdf-wheel.ts](../src/pdf-wheel.ts)：邊界與手勢狀態。
- [math-format.ts](../src/math-format.ts)、[Markdown.tsx](../src/Markdown.tsx)：公式相容與回退。
- [reader-controls.test.ts](../tests/reader-controls.test.ts)：多行公式、程式碼／表格、翻頁邊界與慣性回歸。

PDF.js 的 viewport 與文字層採其[官方範例](https://mozilla.github.io/pdf.js/examples/)與[文字層樣式](https://github.com/mozilla/pdf.js/blob/master/web/text_layer_builder.css)的設計。實際程式以專案鎖定的 PDF.js 6.4.299 API 與 CSS 變數為準。
