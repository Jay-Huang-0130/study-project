import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export function Markdown({ text, navigate }: { text: string; navigate: (n: number) => void }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]}
    components={{ a: ({href,children}) => { const match = href?.match(/^#page=(\d+)$/); return match ? <button className="inline-link" onClick={() => navigate(Number(match[1]))}>{children}</button> : <span>{children}</span>; } }}
  >{text.replace(/第\s*(\d+)\s*頁/g, '[$&](#page=$1)')}</ReactMarkdown></div>;
}
