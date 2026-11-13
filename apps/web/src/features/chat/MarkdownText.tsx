import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-1 text-[15px] font-medium leading-6 text-ink">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-3 text-[14px] font-medium leading-5 text-ink">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2.5 text-[13px] font-medium leading-5 text-ink">{children}</h3>
  ),
  p: ({ children }) => <p className="my-1.5 leading-[1.65] first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-5 marker:text-ink-3">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5 marker:text-ink-3">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-[1.65]">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-accent/30 pl-3 text-ink-2">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-line" />,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-surface-2 px-3 py-2.5 font-mono text-[12px] leading-5 text-ink">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code
      className={
        className
          ? `font-mono ${className}`
          : "rounded bg-black/[.06] px-1 py-[1px] font-mono text-[.92em] text-ink dark:bg-white/[.1]"
      }
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-2 overscroll-x-contain overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-max border-collapse text-left text-[11.5px] [overflow-wrap:anywhere]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-surface-2 text-ink-2">{children}</thead>,
  th: ({ children, style }) => (
    <th
      style={style}
      className="whitespace-nowrap border-b border-line-strong px-3 py-1.5 font-medium"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="max-w-[320px] border-b border-line/70 px-3 py-1.5 align-middle">
      {children}
    </td>
  ),
  tr: ({ children }) => <tr className="even:bg-ink/[.04] last:[&>td]:border-b-0">{children}</tr>,
};

export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown-body [&_pre_code]:bg-transparent [&_pre_code]:p-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
