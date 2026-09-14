import type { ReactNode } from "react"
import { defaultRemarkPlugins } from "streamdown"

import { MessageResponse, type MessageResponseProps } from "@/components/ai-elements/message"
import { fileNameFromPath } from "@/lib/file-path"

import { remarkSandboxFileLinks, sandboxFilePath } from "../sandbox-markdown-links"
import { AssistantFileReference } from "./assistant-file-reference"
import { AssistantMarkdownCode } from "./assistant-markdown-code"

function AssistantSandboxFile({ url, label, children }: Record<string, unknown>) {
  // allowedTags also permits raw HTML, so validate at the renderer boundary.
  const path = sandboxFilePath(url)
  if (!path || typeof label !== "string") return <>{children as ReactNode}</>
  return <AssistantFileReference path={path} label={label || fileNameFromPath(path)} wrap />
}

const assistantMarkdownProps = {
  remarkPlugins: [...Object.values(defaultRemarkPlugins), remarkSandboxFileLinks],
  allowedTags: { "sandbox-file": ["url", "label"] },
  components: { code: AssistantMarkdownCode, "sandbox-file": AssistantSandboxFile },
} satisfies Pick<MessageResponseProps, "remarkPlugins" | "allowedTags" | "components">

export function AssistantMarkdown(props: Omit<MessageResponseProps, "remarkPlugins" | "allowedTags" | "components">) {
  return <MessageResponse {...props} {...assistantMarkdownProps} />
}
