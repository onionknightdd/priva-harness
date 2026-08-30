"use client"

import {
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react"

import { StreamdownMarkdownCode } from "@/components/ai-elements/streamdown-markdown-code"
import { FilePathLink } from "@/features/files/file-path-link"
import { useChatSession } from "@/features/chat-session"
import { looksLikeFilePath, resolveAgainstCwd } from "@/lib/file-path"
import { cn } from "@/lib/utils"

const assistantInlineCodeClassName = "bg-[rgb(236,236,236)] dark:bg-muted"

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

type AssistantMarkdownCodeProps = ComponentProps<typeof StreamdownMarkdownCode>

export function AssistantMarkdownCode({
  className,
  children,
  ...props
}: AssistantMarkdownCodeProps) {
  const isBlock = "data-block" in props
  const { runCwd } = useChatSession()

  if (!isBlock) {
    const text = collectText(children).trim()
    if (looksLikeFilePath(text)) {
      return (
        <FilePathLink
          path={resolveAgainstCwd(text, runCwd)}
          label={text}
          showIcon
          variant="code"
          className={cn(assistantInlineCodeClassName, className)}
        />
      )
    }
  }

  return (
    <StreamdownMarkdownCode
      className={cn(!isBlock && assistantInlineCodeClassName, className)}
      {...props}
    >
      {children}
    </StreamdownMarkdownCode>
  )
}
