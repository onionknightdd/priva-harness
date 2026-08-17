import ReactMarkdown from "react-markdown"

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <article className="mx-auto w-full min-w-0 max-w-3xl space-y-4 break-words p-5 text-sm leading-7 sm:p-8">
      <ReactMarkdown
        components={{
          h1: ({ node: _node, ...props }) => (
            <h1 className="text-2xl font-semibold tracking-tight" {...props} />
          ),
          h2: ({ node: _node, ...props }) => (
            <h2
              className="border-b pb-2 text-xl font-semibold tracking-tight"
              {...props}
            />
          ),
          h3: ({ node: _node, ...props }) => (
            <h3 className="text-lg font-medium" {...props} />
          ),
          p: ({ node: _node, ...props }) => (
            <p
              className="whitespace-pre-wrap text-foreground/90"
              {...props}
            />
          ),
          ul: ({ node: _node, ...props }) => (
            <ul className="ml-5 list-disc space-y-1" {...props} />
          ),
          ol: ({ node: _node, ...props }) => (
            <ol className="ml-5 list-decimal space-y-1" {...props} />
          ),
          blockquote: ({ node: _node, ...props }) => (
            <blockquote
              className="border-l-2 pl-4 text-muted-foreground italic"
              {...props}
            />
          ),
          a: ({ node: _node, ...props }) => (
            <a
              className="font-medium text-foreground underline underline-offset-4"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          pre: ({ node: _node, ...props }) => (
            <pre
              className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs leading-5"
              {...props}
            />
          ),
          code: ({ node: _node, ...props }) => (
            <code
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}
