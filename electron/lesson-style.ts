import type {Book,LessonDetail} from '../src/shared';

/** Soft budgets: essential definitions and derivations take precedence. */
export function lessonGuide(book:Book,page:number,detail:LessonDetail):string{
  const source=book.pages[page-1],entry=book.map?.pages.find(p=>p.page===page);
  const sparse=!entry?.density&&source.text.trim().length<100&&(entry?.summary.length??0)<150;
  const density=entry?.density??(sparse?'brief':'normal');
  const budgets={concise:{brief:'1～3 句，約 40～120 字',normal:'約 150～300 字，最多 3 個重點',dense:'約 300～600 字，只保留必要推導'},
    standard:{brief:'約 60～150 字，不湊段落',normal:'約 250～500 字',dense:'約 450～800 字，逐步說明必要推導'},
    detailed:{brief:'約 80～200 字，簡單頁仍然簡短',normal:'約 400～800 字，必要時補一個例子',dense:'約 600～1200 字，依實際推導需求展開'}};
  return `針對第 ${page} 頁撰寫一對一教學講稿。講解模式：${{concise:'精簡',standard:'標準',detailed:'詳細'}[detail]}。本頁資訊量：${density}；軟目標為 ${budgets[detail][density]}。
先直接說本頁最重要的意思。封面、過場、重複頁或單一定義，只需短段落；不要硬加「學習目標、前置知識、例子、總結」等固定章節。
只有原頁有公式、電路或推導且需要理解時，才逐步展開。不可為縮短字數而省略必要定義、條件、符號意義或關鍵步驟，也不可為湊字數添加無關內容。
優先講清楚本頁，不重複全文翻譯，不重複已說過的重點，不加泛用鼓勵、結語或未要求的練習題。補充與原文分開標示，引用其他頁時保留頁碼。`;
}
