import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {normalizeMath} from './math-format';

export function Markdown({ text, navigate }: { text: string; navigate: (n: number) => void }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]}
    components={{ span: ({className,children,node,...props}) => className?.includes('katex-error')?<span className="math-fallback" title="公式格式無法解析，保留原式供核對"><small>公式原式</small><code>{children}</code></span>:<span className={className} {...props}>{children}</span>, a: ({href,children}) => { const match = href?.match(/^#page=(\d+)$/); return match ? <button className="inline-link" onClick={() => navigate(Number(match[1]))}>{children}</button> : <span>{children}</span>; } }}
  >{normalizeMath(text).replace(/第\s*(\d+)\s*頁/g, '[$&](#page=$1)')}</ReactMarkdown></div>;
}
