import type { ComponentProps } from "react"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import { Streamdown } from "streamdown"

const markdownPlugins = { cjk, code, math, mermaid }

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <article className="mx-auto w-full min-w-0 max-w-3xl p-5 text-sm leading-7 sm:p-8">
      <Streamdown
        className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        // @streamdown/code types Shiki 3; this app already uses Shiki 4.
        plugins={markdownPlugins as ComponentProps<typeof Streamdown>["plugins"]}
      >
        {content}
      </Streamdown>
    </article>
  )
}
