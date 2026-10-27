import type {Book,LessonDetail} from '../src/shared';

/** Bound both page count and expected prose; detailed derivations use smaller batches. */
export function lessonBatchPages(book:Book,detail:LessonDetail,reserved:ReadonlySet<number>=new Set()):number[]{
  const indexed=new Set(book.map?.pages.map(p=>p.page)),result:number[]=[];
  let budget=0;
  for(const page of [...book.pages].sort((a,b)=>a.number-b.number)){
    if(page.status==='done'||reserved.has(page.number))continue;
    if(page.status!=='pending'||!page.imageReady||!indexed.has(page.number))break;
    const density=book.map?.pages.find(p=>p.page===page.number)?.density??'normal';
    const size={concise:{brief:120,normal:300,dense:600},standard:{brief:150,normal:500,dense:800},detailed:{brief:200,normal:800,dense:1200}}[detail][density];
    if(result.length&&(result.length>=5||budget+size>3000))break;
    result.push(page.number);budget+=size;
  }
  return result;
}

export interface LessonRecord {page:number;lesson:string}

/** Parse accumulated JSON records, never treating a partial record as a complete page.
 * JSON string escaping protects Markdown, formulas, braces and literal newlines.
 * Re-reading accumulated text also detects authoritative final-message revisions.
 */
export class LessonBatchStream {
  private saved:LessonRecord[]=[];
  constructor(private expected:number[],private completed:(record:LessonRecord)=>void){}
  update(text:string,final=false){
    if(text.length>2_000_000)throw new Error('多頁講稿超出長度上限，已完成頁面會保留。');
    let at=0,count=0;
    while(at<text.length){
      while(/\s/.test(text[at]??'')&&at<text.length)at++;
      if(at===text.length)break;
      if(text[at]!=='{')throw new Error('多頁講稿分頁格式無效，請繼續生成重試。');
      const start=at;let depth=0,quoted=false,escaped=false,closed=false;
      for(;at<text.length;at++){
        const c=text[at];
        if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
        else if(c==='"')quoted=true;
        else if(c==='{')depth++;
        else if(c==='}'&&--depth===0){at++;closed=true;break;}
      }
      if(!closed){if(final)throw new Error('多頁講稿中途截斷，已完成頁面會保留，請繼續生成。');break;}
      const record=JSON.parse(text.slice(start,at));
      if(record.page!==this.expected[count]||typeof record.lesson!=='string'||!record.lesson.trim()||Object.keys(record).some(k=>k!=='page'&&k!=='lesson'))throw new Error('多頁講稿頁碼重複、順序或內容無效，已完成頁面會保留。');
      if(count<this.saved.length){if(record.lesson!==this.saved[count].lesson)throw new Error('模型修改了已輸出的講稿，已保存版本會保留，請繼續生成。');}
      else {this.completed(record);this.saved.push(record);}
      count++;
    }
    if(final&&count!==this.expected.length)throw new Error('多頁講稿尚有缺頁，已完成頁面會保留，請繼續生成。');
    if(final&&count<this.saved.length)throw new Error('模型最終講稿與已輸出內容不符。');
  }
}
