import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * AI 回复的 Markdown 渲染。
 * 禁用原始 HTML（react-markdown 默认行为），表格/列表/代码块走 GFM。
 */
const components: Components = {
  p: ({ children }) => (
    <p className="my-1.5 break-words text-[12.5px] leading-[1.7] first:mt-0 last:mb-0">
      {children}
    </p>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted line-through">{children}</del>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline underline-offset-2 hover:text-accent/80"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 ml-4 list-disc space-y-0.5 text-[12.5px] leading-[1.65]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 ml-4 list-decimal space-y-0.5 text-[12.5px] leading-[1.65]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h1 className="mt-3 mb-1 text-[14px] font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1 text-[13.5px] font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2.5 mb-1 text-[13px] font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-[12.5px] font-semibold">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-2.5 text-muted">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  code: ({ children, className }) => (
    <code
      className={`rounded bg-surface-secondary px-1 py-0.5 font-mono text-[11px] ${
        className ?? ''
      }`}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-border bg-surface-secondary p-2 font-mono text-[11px] leading-5">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse overflow-hidden rounded-md border border-border text-[11.5px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-secondary">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
}

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className={`atp-markdown min-w-0${streaming ? ' atp-markdown-streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
