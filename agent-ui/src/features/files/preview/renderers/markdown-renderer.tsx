import type { ComponentProps } from "react"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import { Streamdown } from "streamdown"

import { streamdownLinkSafety } from "@/components/ai-elements/streamdown-link-safety"
import { streamdownMarkdownComponents } from "@/components/ai-elements/streamdown-markdown-components"
import { StreamdownMarkdownCode } from "@/components/ai-elements/streamdown-markdown-code"

const markdownPlugins = { cjk, code, math, mermaid }
const fileMarkdownComponents = { ...streamdownMarkdownComponents, code: FileMarkdownCode }

function FileMarkdownCode(props: ComponentProps<typeof StreamdownMarkdownCode>) {
  return <StreamdownMarkdownCode {...props} deferHighlight />
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <article className="mx-auto w-full min-w-0 max-w-3xl p-5 text-sm leading-7 sm:p-8">
      <Streamdown
        parseIncompleteMarkdown={false}
        className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        // @streamdown/code types Shiki 3; this app already uses Shiki 4.
        plugins={markdownPlugins as ComponentProps<typeof Streamdown>["plugins"]}
        components={fileMarkdownComponents}
        linkSafety={streamdownLinkSafety}
      >
        {content}
      </Streamdown>
    </article>
  )
}
