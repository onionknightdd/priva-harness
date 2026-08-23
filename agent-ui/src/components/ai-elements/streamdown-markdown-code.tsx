"use client"

import { isValidElement, useContext, type ComponentProps, type ReactNode } from "react"
import { mermaid } from "@streamdown/mermaid"
import {
  Streamdown,
  StreamdownContext,
  useIsCodeFenceIncomplete,
  type ExtraProps,
} from "streamdown"

import { CodeBlock } from "@/components/agents/code-block"
import { MermaidEdgeResize } from "@/components/ai-elements/mermaid-edge-resize"
import { cn } from "@/lib/utils"

function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return ""
  }

  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(collectText).join("")
  }

  if (isValidElement(node)) {
    return collectText(
      (node.props as { children?: ReactNode }).children
    )
  }

  return ""
}

function trimTrailingNewlines(value: string) {
  let end = value.length

  while (end > 0 && value[end - 1] === "\n") {
    end -= 1
  }

  return value.slice(0, end)
}

function languageFromClassName(className?: string) {
  return className?.match(/language-([^\s]+)/)?.[1] ?? ""
}

function filenameFromNode(node: ExtraProps["node"]) {
  const meta = node?.properties?.metastring
  return typeof meta === "string"
    ? meta.match(/(?:filename|title)=["']([^"']+)["']/)?.[1]
    : undefined
}

type StreamdownMarkdownCodeProps = ComponentProps<"code"> & ExtraProps

export function StreamdownMarkdownCode({
  className,
  children,
  node,
  ...props
}: StreamdownMarkdownCodeProps) {
  const isIncomplete = useIsCodeFenceIncomplete()
  const { lineNumbers } = useContext(StreamdownContext)
  const isBlock = "data-block" in props

  if (!isBlock) {
    return (
      <code
        className={cn(
          "rounded bg-muted px-1.5 py-0.5 font-mono text-sm",
          className
        )}
        data-streamdown="inline-code"
        {...props}
      >
        {children}
      </code>
    )
  }

  const language = languageFromClassName(className)
  const code = trimTrailingNewlines(collectText(children))
  const filename = filenameFromNode(node)

  if (language === "mermaid") {
    return (
      <MermaidEdgeResize>
        <Streamdown className="min-h-0 w-full" plugins={{ mermaid }}>
          {`\`\`\`mermaid\n${code}\n\`\`\``}
        </Streamdown>
      </MermaidEdgeResize>
    )
  }

  return (
    <CodeBlock
      className="my-4"
      code={code}
      filename={filename}
      language={language || "text"}
      showLineNumbers={lineNumbers !== false}
      status={isIncomplete ? "streaming" : "complete"}
    />
  )
}
